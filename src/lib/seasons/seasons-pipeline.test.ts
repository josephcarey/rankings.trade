import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { describe, expect, it } from "vitest";

import type { Round } from "../db/rounds";

import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import { getRoundByResetDate } from "../db/rounds";
import {
  countRankedRoundsByAgent,
  getSeasonById,
  insertSeason,
  isInUnrankedGap,
  listSeasonStandings,
} from "../db/seasons";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import { seasonCloseEvaluator, seasonCloseTrigger, unrankedUntilFor } from "./close";
import { seasonResolver } from "./resolver";
import { computeSeasonStandings } from "./standings";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

async function agent(db: D1Database, symbol: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol) VALUES (?) RETURNING id")
    .bind(symbol)
    .first<{ id: number }>();
  return row!.id;
}

/** Insert a finalized round (optionally ranked + season-tagged). */
async function finalizedRound(
  db: D1Database,
  resetDate: string,
  isRanked = false,
  seasonId: number | null = null,
): Promise<Round> {
  await db
    .prepare(
      `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
       VALUES (?, ?, ?, '2026-06-01T00:00:00Z')`,
    )
    .bind(resetDate, seasonId, isRanked ? 1 : 0)
    .run();
  return (await getRoundByResetDate(db, resetDate))!;
}

/** Seed a participated Universe standing so ranked-round counts are non-zero. */
async function universeStanding(
  db: D1Database,
  roundId: number,
  symbol: string,
  agentId: number,
  credits: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO round_standings
         (round_id, league_id, agent_symbol, agent_id, final_credits, final_rank, participated)
       VALUES (?, NULL, ?, ?, ?, 1, 1)`,
    )
    .bind(roundId, symbol, agentId, credits)
    .run();
}

/** Give an agent a season rating directly (bypassing the Glicko maths). */
async function seedRating(
  db: D1Database,
  agentId: number,
  seasonId: number,
  rating: number,
  rd: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ratings (agent_id, season_id, rating, rd, volatility)
       VALUES (?, ?, ?, ?, 0.06)`,
    )
    .bind(agentId, seasonId, rating, rd)
    .run();
}

/** Seed a closable season with two established agents and return its closing round. */
async function setupClosableSeason(db: D1Database) {
  const season = await insertSeason(db, {
    label: "S1",
    cutoff_date: "2026-08-15",
    unranked_gap_days: 7,
  });
  const a1 = await agent(db, "AAA");
  const a2 = await agent(db, "BBB");
  // Three ranked rounds so both agents clear the established floor (≥3 ranked rounds).
  for (const date of ["2026-08-10", "2026-08-12", "2026-08-15"]) {
    const round = await finalizedRound(db, date, true, season.id);
    await universeStanding(db, round.id, "AAA", a1, 1000);
    await universeStanding(db, round.id, "BBB", a2, 500);
  }
  await seedRating(db, a1, season.id, 1700, 50);
  await seedRating(db, a2, season.id, 1500, 60);
  const closingRound = (await getRoundByResetDate(db, "2026-08-15"))!;
  return { season, a1, a2, closingRound };
}

describe("seasonResolver.resolve", () => {
  it("returns unranked/null when there is no open season", async () => {
    const db = await freshDb();
    expect(await seasonResolver.resolve(db, "2026-07-01")).toEqual({
      isRanked: false,
      seasonId: null,
    });
  });

  it("tags a round ranked with the open season's id (invariant: ranked ⇒ non-null season)", async () => {
    const db = await freshDb();
    const season = await insertSeason(db, {
      label: "S1",
      cutoff_date: "2026-09-01",
      unranked_gap_days: 0,
    });
    const result = await seasonResolver.resolve(db, "2026-07-01");
    expect(result.isRanked).toBe(true);
    expect(result.seasonId).toBe(season.id);
  });

  it("tags rounds in a prior season's unranked gap as unranked even while a new season is open", async () => {
    const db = await freshDb();
    // Close S1 at 2026-08-01 with a 7-day gap.
    const s1 = await insertSeason(db, {
      label: "S1",
      cutoff_date: "2026-08-01",
      unranked_gap_days: 7,
    });
    const closing = await finalizedRound(db, "2026-08-01", true, s1.id);
    await db
      .prepare(
        `UPDATE seasons SET closed_at = CURRENT_TIMESTAMP, closed_round_id = ?, unranked_until = '2026-08-08' WHERE id = ?`,
      )
      .bind(closing.id, s1.id)
      .run();
    // Open S2.
    const s2 = await insertSeason(db, {
      label: "S2",
      cutoff_date: "2026-12-01",
      unranked_gap_days: 0,
    });

    // A round inside the gap → unranked, despite S2 being open.
    expect(await isInUnrankedGap(db, "2026-08-04")).toBe(true);
    expect(await seasonResolver.resolve(db, "2026-08-04")).toEqual({
      isRanked: false,
      seasonId: null,
    });
    // A round on/after the gap end → ranked into S2.
    expect(await seasonResolver.resolve(db, "2026-08-08")).toEqual({
      isRanked: true,
      seasonId: s2.id,
    });
  });
});

describe("unrankedUntilFor", () => {
  it("is null for a zero gap and the closing date plus N days otherwise", () => {
    expect(unrankedUntilFor("2026-08-01", 0)).toBeNull();
    expect(unrankedUntilFor("2026-08-01", 7)).toBe("2026-08-08");
    // Handles a datetime reset_date by using its date portion.
    expect(unrankedUntilFor("2026-08-01T12:00:00Z", 3)).toBe("2026-08-04");
  });
});

describe("seasonCloseEvaluator.shouldCloseSeason", () => {
  it("closes only the first reset on/after the cutoff", async () => {
    const db = await freshDb();
    const season = await insertSeason(db, {
      label: "S1",
      cutoff_date: "2026-08-15",
      unranked_gap_days: 0,
    });

    const before = await finalizedRound(db, "2026-08-01", true, season.id);
    expect(await seasonCloseEvaluator.shouldCloseSeason(db, before)).toBe(false);

    const onCutoff = await finalizedRound(db, "2026-08-15", true, season.id);
    expect(await seasonCloseEvaluator.shouldCloseSeason(db, onCutoff)).toBe(true);
  });

  it("does not close for an unranked round (no season id)", async () => {
    const db = await freshDb();
    await insertSeason(db, { label: "S1", cutoff_date: "2026-08-15", unranked_gap_days: 0 });
    const unranked = await finalizedRound(db, "2026-09-01");
    expect(await seasonCloseEvaluator.shouldCloseSeason(db, unranked)).toBe(false);
  });

  it("does not re-close an already-closed season", async () => {
    const db = await freshDb();
    const season = await insertSeason(db, {
      label: "S1",
      cutoff_date: "2026-08-15",
      unranked_gap_days: 0,
    });
    const round = await finalizedRound(db, "2026-08-20", true, season.id);
    await db
      .prepare("UPDATE seasons SET closed_at = CURRENT_TIMESTAMP, closed_round_id = ? WHERE id = ?")
      .bind(round.id, season.id)
      .run();
    expect(await seasonCloseEvaluator.shouldCloseSeason(db, round)).toBe(false);
  });
});

describe("seasonCloseTrigger.onSeasonClose", () => {
  it("archives final standings, ranks, titles and stamps the season closed with the gap", async () => {
    const db = await freshDb();
    const { season, a1, closingRound } = await setupClosableSeason(db);

    await seasonCloseTrigger.onSeasonClose(db, closingRound);

    const standings = await listSeasonStandings(db, season.id);
    expect(standings).toHaveLength(2);
    const leader = standings.find((s) => s.agent_id === a1)!;
    expect(leader.final_rank).toBe(1);
    expect(leader.final_rating).toBe(1700);
    expect(leader.ranked_rounds).toBe(3);
    expect(leader.established).toBe(1);
    expect(leader.title).toBe("Captain"); // 1700 ≥ 1650 (Captain), below Commodore's 1750

    const closed = await getSeasonById(db, season.id);
    expect(closed!.closed_at).not.toBeNull();
    expect(closed!.closed_round_id).toBe(closingRound.id);
    expect(closed!.unranked_until).toBe("2026-08-22"); // 2026-08-15 + 7 days
  });

  it("is idempotent: a replay re-runs without double-archiving or re-closing", async () => {
    const db = await freshDb();
    const { season, closingRound } = await setupClosableSeason(db);

    await seasonCloseTrigger.onSeasonClose(db, closingRound);
    const firstClosedAt = (await getSeasonById(db, season.id))!.closed_at;
    const firstStandings = await listSeasonStandings(db, season.id);

    // Replay (mirrors the orchestrator's recovery sweep re-entering the trigger).
    await seasonCloseTrigger.onSeasonClose(db, closingRound);

    const afterStandings = await listSeasonStandings(db, season.id);
    expect(afterStandings).toHaveLength(firstStandings.length); // no duplicate rows
    expect((await getSeasonById(db, season.id))!.closed_at).toBe(firstClosedAt); // not re-stamped
  });
});

describe("computeSeasonStandings + countRankedRoundsByAgent", () => {
  it("excludes unestablished agents from titles and counts only ranked participations", async () => {
    const db = await freshDb();
    const season = await insertSeason(db, {
      label: "S1",
      cutoff_date: "2026-12-01",
      unranked_gap_days: 0,
    });
    const a1 = await agent(db, "AAA");
    const a2 = await agent(db, "BBB");

    // a1 plays 3 ranked rounds (established); a2 plays 1 (unestablished by min-rounds).
    for (const date of ["2026-09-01", "2026-09-08", "2026-09-15"]) {
      const round = await finalizedRound(db, date, true, season.id);
      await universeStanding(db, round.id, "AAA", a1, 1000);
    }
    const single = await finalizedRound(db, "2026-09-22", true, season.id);
    await universeStanding(db, single.id, "BBB", a2, 800);

    await seedRating(db, a1, season.id, 1600, 40);
    await seedRating(db, a2, season.id, 1900, 40);

    const counts = await countRankedRoundsByAgent(db, season.id);
    expect(counts.get(a1)).toBe(3);
    expect(counts.get(a2)).toBe(1);

    const standings = await computeSeasonStandings(db, season.id);
    const s1 = standings.find((s) => s.agent_id === a1)!;
    const s2 = standings.find((s) => s.agent_id === a2)!;
    expect(s1.established).toBe(true);
    expect(s1.title).toBe("Commander"); // 1600 established ⇒ threshold tier
    expect(s2.established).toBe(false); // only 1 ranked round
    expect(s2.title).toBeNull();
    // a2 has the higher rating, so it still ranks #1 even though it has no title.
    expect(s2.final_rank).toBe(1);
    expect(s1.final_rank).toBe(2);
  });
});
