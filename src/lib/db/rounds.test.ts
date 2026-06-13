import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import {
  beginFinalization,
  getFinalObservedAt,
  getFirstObservedAt,
  getMembersFrozenAt,
  getOrCreateRound,
  getRoundById,
  getRoundByResetDate,
  getSnapshotRowsAt,
  insertStandings,
  listEndedResetDates,
  listRateableUniverseStandings,
  listRoundsPendingTriggers,
  listStandings,
  markFinalized,
  markRatingsApplied,
  markSeasonProcessed,
  type StandingInsert,
} from "./rounds";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

async function insertSnapshot(
  db: D1Database,
  resetDate: string,
  observedAt: string,
  symbol: string,
  credits: number,
  rank: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO snapshots
         (reset_date, observed_at, agent_symbol, credits, credit_rank, total_agents, ship_count, faction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(resetDate, observedAt, symbol, credits, rank, 99, 1, "COSMIC")
    .run();
}

async function insertAgent(db: D1Database, symbol: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol) VALUES (?) RETURNING id")
    .bind(symbol)
    .first<{ id: number }>();
  return row!.id;
}

async function insertLeague(db: D1Database, name: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO leagues (name) VALUES (?) RETURNING id")
    .bind(name)
    .first<{ id: number }>();
  return row!.id;
}

async function insertMember(
  db: D1Database,
  leagueId: number,
  agentId: number,
  joinedAt: string,
  leftAt: string | null,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO league_members (league_id, agent_id, joined_at, left_at) VALUES (?, ?, ?, ?)",
    )
    .bind(leagueId, agentId, joinedAt, leftAt)
    .run();
}

const standing = (over: Partial<StandingInsert>): StandingInsert => ({
  round_id: 1,
  league_id: null,
  agent_symbol: "ALPHA",
  agent_id: null,
  final_credits: 100,
  final_rank: 1,
  participated: 1,
  ...over,
});

describe("rounds db helpers", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  describe("getOrCreateRound", () => {
    it("creates an unranked, untagged round and is idempotent", async () => {
      const first = await getOrCreateRound(db, "2026-06-01");
      expect(first.is_ranked).toBe(0);
      expect(first.season_id).toBeNull();
      expect(first.finalized_at).toBeNull();

      const again = await getOrCreateRound(db, "2026-06-01");
      expect(again.id).toBe(first.id);

      const count = await db
        .prepare("SELECT COUNT(*) AS n FROM rounds")
        .first<{ n: number }>();
      expect(count?.n).toBe(1);
    });
  });

  describe("beginFinalization", () => {
    it("persists immutable inputs once and freezes membership", async () => {
      const round = await getOrCreateRound(db, "2026-06-01");
      const claimed = await beginFinalization(db, round.id, {
        finalObservedAt: "2026-06-12T15:00",
        startedAt: "2026-06-01T00:00",
        seasonId: 3,
        isRanked: true,
      });
      expect(claimed.final_observed_at).toBe("2026-06-12T15:00");
      expect(claimed.season_id).toBe(3);
      expect(claimed.is_ranked).toBe(1);
      expect(claimed.membership_frozen_at).not.toBeNull();
    });

    it("does not overwrite the winner's inputs on a second (losing) claim", async () => {
      const round = await getOrCreateRound(db, "2026-06-01");
      await beginFinalization(db, round.id, {
        finalObservedAt: "2026-06-12T15:00",
        startedAt: null,
        seasonId: 3,
        isRanked: true,
      });
      const second = await beginFinalization(db, round.id, {
        finalObservedAt: "2026-06-12T99:99",
        startedAt: null,
        seasonId: 999,
        isRanked: false,
      });
      expect(second.final_observed_at).toBe("2026-06-12T15:00");
      expect(second.season_id).toBe(3);
      expect(second.is_ranked).toBe(1);
    });
  });

  describe("single-winner markers", () => {
    it("markFinalized flips once", async () => {
      const round = await getOrCreateRound(db, "2026-06-01");
      expect(await markFinalized(db, round.id)).toBe(true);
      expect(await markFinalized(db, round.id)).toBe(false);
      const after = await getRoundById(db, round.id);
      expect(after?.finalized_at).not.toBeNull();
    });

    it("markRatingsApplied and markSeasonProcessed each flip once", async () => {
      const round = await getOrCreateRound(db, "2026-06-01");
      expect(await markRatingsApplied(db, round.id)).toBe(true);
      expect(await markRatingsApplied(db, round.id)).toBe(false);
      expect(await markSeasonProcessed(db, round.id)).toBe(true);
      expect(await markSeasonProcessed(db, round.id)).toBe(false);
    });
  });

  describe("insertStandings", () => {
    it("is a no-op on an empty list and idempotent on re-insert", async () => {
      const round = await getOrCreateRound(db, "2026-06-01");
      await insertStandings(db, []);
      await insertStandings(db, [
        standing({ round_id: round.id, agent_symbol: "ALPHA", final_rank: 1 }),
        standing({ round_id: round.id, agent_symbol: "BRAVO", final_rank: 2 }),
      ]);
      // Re-insert the same Universe rows with different metrics — IGNORE keeps the first.
      await insertStandings(db, [
        standing({ round_id: round.id, agent_symbol: "ALPHA", final_rank: 9, final_credits: 1 }),
      ]);
      const rows = await listStandings(db, round.id, null);
      expect(rows.map((r) => r.agent_symbol)).toEqual(["ALPHA", "BRAVO"]);
      expect(rows[0]?.final_rank).toBe(1);
    });

    it("chunks past the D1 batch limit", async () => {
      const round = await getOrCreateRound(db, "2026-06-01");
      const rows = Array.from({ length: 250 }, (_, i) =>
        standing({ round_id: round.id, agent_symbol: `A${i}`, final_rank: i + 1 }),
      );
      await insertStandings(db, rows);
      const count = await db
        .prepare("SELECT COUNT(*) AS n FROM round_standings WHERE round_id = ?")
        .bind(round.id)
        .first<{ n: number }>();
      expect(count?.n).toBe(250);
    });

    it("keeps Universe and per-league standings as independent scopes", async () => {
      const round = await getOrCreateRound(db, "2026-06-01");
      const league = await insertLeague(db, "Spacejam");
      await insertStandings(db, [
        standing({ round_id: round.id, league_id: null, agent_symbol: "ALPHA", final_rank: 1 }),
        standing({ round_id: round.id, league_id: league, agent_symbol: "ALPHA", final_rank: 1 }),
      ]);
      expect(await listStandings(db, round.id, null)).toHaveLength(1);
      expect(await listStandings(db, round.id, league)).toHaveLength(1);
    });
  });

  describe("listRateableUniverseStandings", () => {
    it("excludes non-participants and unregistered agents", async () => {
      const round = await getOrCreateRound(db, "2026-06-01");
      await insertStandings(db, [
        standing({ round_id: round.id, agent_symbol: "REG", agent_id: 1, final_credits: 500, final_rank: 1 }),
        standing({ round_id: round.id, agent_symbol: "NOID", agent_id: null, final_credits: 400, final_rank: 2 }),
        standing({ round_id: round.id, agent_symbol: "ABSENT", agent_id: 2, final_credits: null, participated: 0, final_rank: 3 }),
      ]);
      const rateable = await listRateableUniverseStandings(db, round.id);
      expect(rateable.map((r) => r.agent_symbol)).toEqual(["REG"]);
    });
  });

  describe("listEndedResetDates", () => {
    it("returns snapshot resets that are not live and not yet finalized", async () => {
      await insertSnapshot(db, "2026-05-01", "2026-05-30T00:00", "ALPHA", 100, 1);
      await insertSnapshot(db, "2026-06-01", "2026-06-30T00:00", "ALPHA", 200, 1);
      // Live round is 2026-06-01; the May round has ended.
      expect(await listEndedResetDates(db, "2026-06-01")).toEqual(["2026-05-01"]);
    });

    it("omits a reset that already has a finalized round", async () => {
      await insertSnapshot(db, "2026-05-01", "2026-05-30T00:00", "ALPHA", 100, 1);
      const round = await getOrCreateRound(db, "2026-05-01");
      await markFinalized(db, round.id);
      expect(await listEndedResetDates(db, "2026-06-01")).toEqual([]);
    });

    it("is empty for the very first round (no prior reset)", async () => {
      await insertSnapshot(db, "2026-06-01", "2026-06-01T00:00", "ALPHA", 100, 1);
      expect(await listEndedResetDates(db, "2026-06-01")).toEqual([]);
    });
  });

  describe("listRoundsPendingTriggers", () => {
    it("lists finalized rounds with outstanding ratings or season work", async () => {
      // Unranked finalized round still needs a season evaluation.
      const a = await getOrCreateRound(db, "2026-05-01");
      await markFinalized(db, a.id);
      // Fully processed round is excluded.
      const b = await getOrCreateRound(db, "2026-04-01");
      await markFinalized(db, b.id);
      await markSeasonProcessed(db, b.id);
      const pending = await listRoundsPendingTriggers(db);
      expect(pending.map((r) => r.reset_date)).toEqual(["2026-05-01"]);
    });

    it("excludes a non-finalized round", async () => {
      await getOrCreateRound(db, "2026-05-01");
      expect(await listRoundsPendingTriggers(db)).toEqual([]);
    });
  });

  describe("snapshot observation helpers", () => {
    it("returns min/max observed_at and the rows at one observation", async () => {
      await insertSnapshot(db, "2026-06-01", "2026-06-01T00:00", "ALPHA", 10, 2);
      await insertSnapshot(db, "2026-06-01", "2026-06-12T15:00", "ALPHA", 500, 1);
      await insertSnapshot(db, "2026-06-01", "2026-06-12T15:00", "BRAVO", 300, 2);
      expect(await getFirstObservedAt(db, "2026-06-01")).toBe("2026-06-01T00:00");
      expect(await getFinalObservedAt(db, "2026-06-01")).toBe("2026-06-12T15:00");

      const rows = await getSnapshotRowsAt(db, "2026-06-01", "2026-06-12T15:00");
      expect(rows.map((r) => r.agent_symbol)).toEqual(["ALPHA", "BRAVO"]);
      expect(rows[0]).toEqual({
        agent_symbol: "ALPHA",
        agent_id: null,
        credits: 500,
        credit_rank: 1,
      });
    });

    it("returns null max for a reset with no snapshots", async () => {
      expect(await getFinalObservedAt(db, "nope")).toBeNull();
    });
  });

  describe("getMembersFrozenAt", () => {
    it("reconstructs the roster as of the freeze point", async () => {
      const league = await insertLeague(db, "Spacejam");
      const stayed = await insertAgent(db, "STAYED");
      const leftLater = await insertAgent(db, "LEFTLATER");
      const leftBefore = await insertAgent(db, "LEFTBEFORE");
      const joinedLater = await insertAgent(db, "JOINEDLATER");

      const frozen = "2026-06-12 15:00:00";
      await insertMember(db, league, stayed, "2026-06-01 00:00:00", null);
      // Left AFTER the freeze → still a member at freeze time.
      await insertMember(db, league, leftLater, "2026-06-01 00:00:00", "2026-06-13 00:00:00");
      // Left BEFORE the freeze → excluded.
      await insertMember(db, league, leftBefore, "2026-06-01 00:00:00", "2026-06-10 00:00:00");
      // Joined AFTER the freeze → excluded.
      await insertMember(db, league, joinedLater, "2026-06-20 00:00:00", null);

      const members = await getMembersFrozenAt(db, frozen);
      expect(members.map((m) => m.agent_symbol).toSorted()).toEqual(["LEFTLATER", "STAYED"]);
      expect(members.every((m) => m.league_id === league)).toBe(true);
    });
  });

  describe("getRoundByResetDate / getRoundById", () => {
    it("returns null for unknown rounds", async () => {
      expect(await getRoundByResetDate(db, "missing")).toBeNull();
      expect(await getRoundById(db, 999)).toBeNull();
    });
  });
});
