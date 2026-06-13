import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { Round } from "../db/rounds";

import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import {
  countOpenSeasonStandings,
  selectOpenSeasonStanding,
  selectOpenSeasonStandings,
  selectOpenSeasonStandingsPage,
} from "../db/open-standings";
import { getRoundByResetDate } from "../db/rounds";
import { insertSeason } from "../db/seasons";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import { glickoRatingTrigger } from "../ratings/trigger";
import { materializeOpenSeasonStandings } from "./materialize";
import {
  readOpenSeasonLeaderboardPage,
  readOpenSeasonStandingForAgent,
  readOpenSeasonStandings,
} from "./read-standings";
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

/** Open a season (cutoff far in the future so a round never auto-closes it). */
async function openSeason(db: D1Database): Promise<number> {
  const season = await insertSeason(db, {
    label: "S1",
    cutoff_date: "2999-01-01",
    unranked_gap_days: 0,
  });
  return season.id;
}

async function finalizedRound(
  db: D1Database,
  resetDate: string,
  seasonId: number,
): Promise<Round> {
  await db
    .prepare(
      `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
       VALUES (?, ?, 1, '2026-06-01T00:00:00Z')`,
    )
    .bind(resetDate, seasonId)
    .run();
  return (await getRoundByResetDate(db, resetDate))!;
}

async function universeStanding(
  db: D1Database,
  roundId: number,
  symbol: string,
  agentId: number,
  credits: number,
  rank: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO round_standings
         (round_id, league_id, agent_symbol, agent_id, final_credits, final_rank, participated)
       VALUES (?, NULL, ?, ?, ?, ?, 1)`,
    )
    .bind(roundId, symbol, agentId, credits, rank)
    .run();
}

/** Rate a ranked round end-to-end (which also materializes the cache). */
async function rateRound(
  db: D1Database,
  seasonId: number,
  resetDate: string,
  field: { symbol: string; id: number; credits: number }[],
): Promise<Round> {
  const round = await finalizedRound(db, resetDate, seasonId);
  for (const [i, f] of field
    .toSorted((a, b) => b.credits - a.credits)
    .entries()) {
    await universeStanding(db, round.id, f.symbol, f.id, f.credits, i + 1);
  }
  await glickoRatingTrigger.onRankedRoundFinalized(db, round);
  return round;
}

describe("materializeOpenSeasonStandings — cache equals a fresh compute", () => {
  let db: D1Database;
  let season: number;
  let ids: { ALPHA: number; BRAVO: number; CHARLIE: number };

  beforeEach(async () => {
    db = await freshDb();
    season = await openSeason(db);
    ids = {
      ALPHA: await agent(db, "ALPHA"),
      BRAVO: await agent(db, "BRAVO"),
      CHARLIE: await agent(db, "CHARLIE"),
    };
  });

  it("writes the cache on ranked-round finalize, identical to computeSeasonStandings", async () => {
    await rateRound(db, season, "2026-06-01", [
      { symbol: "ALPHA", id: ids.ALPHA, credits: 900 },
      { symbol: "BRAVO", id: ids.BRAVO, credits: 500 },
      { symbol: "CHARLIE", id: ids.CHARLIE, credits: 100 },
    ]);

    const cached = await selectOpenSeasonStandings(db, season);
    const fresh = await computeSeasonStandings(db, season);
    expect(cached).toEqual(fresh);
    expect(cached).toHaveLength(3);
  });

  it("re-running the trigger (replay) leaves the cache identical — idempotent", async () => {
    const round = await rateRound(db, season, "2026-06-01", [
      { symbol: "ALPHA", id: ids.ALPHA, credits: 900 },
      { symbol: "BRAVO", id: ids.BRAVO, credits: 500 },
    ]);
    const first = await selectOpenSeasonStandings(db, season);

    // Replay: the rating period is already applied, but the trigger must still re-materialize.
    await glickoRatingTrigger.onRankedRoundFinalized(db, round);
    const second = await selectOpenSeasonStandings(db, season);

    expect(second).toEqual(first);
    expect(await countOpenSeasonStandings(db, season)).toBe(2);
  });

  it("refreshes the cache after a second round changes ratings", async () => {
    await rateRound(db, season, "2026-06-01", [
      { symbol: "ALPHA", id: ids.ALPHA, credits: 900 },
      { symbol: "BRAVO", id: ids.BRAVO, credits: 500 },
    ]);
    await rateRound(db, season, "2026-06-08", [
      { symbol: "BRAVO", id: ids.BRAVO, credits: 900 },
      { symbol: "ALPHA", id: ids.ALPHA, credits: 500 },
    ]);

    const cached = await selectOpenSeasonStandings(db, season);
    const fresh = await computeSeasonStandings(db, season);
    expect(cached).toEqual(fresh);
    // Each cache row records the latest round that materialized it.
    const round2 = await getRoundByResetDate(db, "2026-06-08");
    const stamps = await db
      .prepare(
        "SELECT DISTINCT materialized_round_id AS r FROM open_season_standings WHERE season_id = ?",
      )
      .bind(season)
      .all<{ r: number }>();
    expect(stamps.results).toEqual([{ r: round2!.id }]);
  });

  it("direct materialize call mirrors computeSeasonStandings for a single agent", async () => {
    await rateRound(db, season, "2026-06-01", [
      { symbol: "ALPHA", id: ids.ALPHA, credits: 900 },
      { symbol: "BRAVO", id: ids.BRAVO, credits: 500 },
    ]);
    await materializeOpenSeasonStandings(db, season, null);

    const cachedRow = await selectOpenSeasonStanding(db, season, ids.ALPHA);
    const allFresh = await computeSeasonStandings(db, season);
    const fresh = allFresh.find((s) => s.agent_id === ids.ALPHA);
    expect(cachedRow).toEqual(fresh);
  });
});

describe("open-season standings — SQL pagination", () => {
  let db: D1Database;
  let season: number;

  beforeEach(async () => {
    db = await freshDb();
    season = await openSeason(db);
    const field: { symbol: string; id: number; credits: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const symbol = `AG${i}`;
      field.push({ symbol, id: await agent(db, symbol), credits: 1000 - i * 100 });
    }
    await rateRound(db, season, "2026-06-01", field);
  });

  it("pushes limit/offset into SQL and returns the canonical slice", async () => {
    const fresh = await computeSeasonStandings(db, season);
    const page = await selectOpenSeasonStandingsPage(db, season, 2, 1);
    expect(page.map((r) => r.agent_id)).toEqual([
      fresh[1]!.agent_id,
      fresh[2]!.agent_id,
    ]);
  });

  it("readOpenSeasonLeaderboardPage returns the slice plus the full-field total", async () => {
    const { rows, total } = await readOpenSeasonLeaderboardPage(db, season, {
      limit: 2,
      offset: 2,
    });
    expect(total).toBe(5);
    expect(rows).toHaveLength(2);
    const fresh = await computeSeasonStandings(db, season);
    expect(rows.map((r) => r.agent_id)).toEqual([
      fresh[2]!.agent_id,
      fresh[3]!.agent_id,
    ]);
    // Symbol is joined in SQL.
    expect(rows[0]!.agent_symbol).toMatch(/^AG\d$/);
  });

  it("an out-of-range offset yields an empty page but the true total", async () => {
    const { rows, total } = await readOpenSeasonLeaderboardPage(db, season, {
      limit: 10,
      offset: 99,
    });
    expect(rows).toEqual([]);
    expect(total).toBe(5);
  });
});

describe("open-season standings — cold-cache fallback", () => {
  let db: D1Database;
  let season: number;
  let alpha: number;

  beforeEach(async () => {
    db = await freshDb();
    season = await openSeason(db);
    alpha = await agent(db, "ALPHA");
    const bravo = await agent(db, "BRAVO");
    // Apply ratings WITHOUT materializing (simulates the post-migration cold window): insert
    // ratings rows directly so the cache stays empty but computeSeasonStandings has data.
    for (const [id, rating] of [
      [alpha, 1600],
      [bravo, 1400],
    ] as const) {
      await db
        .prepare(
          `INSERT INTO ratings (agent_id, season_id, rating, rd, volatility)
           VALUES (?, ?, ?, 40, 0.06)`,
        )
        .bind(id, season, rating)
        .run();
    }
  });

  it("falls back to a fresh compute when the cache is empty", async () => {
    expect(await countOpenSeasonStandings(db, season)).toBe(0);
    const list = await readOpenSeasonStandings(db, season);
    const fresh = await computeSeasonStandings(db, season);
    expect(list).toEqual(fresh);
    expect(list).toHaveLength(2);
  });

  it("falls back for a single-agent read when the cache is cold", async () => {
    const row = await readOpenSeasonStandingForAgent(db, season, alpha);
    expect(row?.agent_id).toBe(alpha);
  });

  it("falls back for a paginated read, computing the field once", async () => {
    const { rows, total } = await readOpenSeasonLeaderboardPage(db, season, {
      limit: 1,
      offset: 0,
    });
    expect(total).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agent_id).toBe(alpha); // 1600 > 1400 ⇒ first
  });

  it("returns null for a genuinely unrated agent once the cache is warm", async () => {
    await materializeOpenSeasonStandings(db, season, null);
    const ghost = await agent(db, "GHOST");
    expect(await readOpenSeasonStandingForAgent(db, season, ghost)).toBeNull();
  });
});

describe("open-season standings — DEC-I2 open/closed scoping", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("does not materialize once the round's season is no longer the open season", async () => {
    const season = await openSeason(db);
    const a = await agent(db, "ALPHA");
    const round = await finalizedRound(db, "2026-06-01", season);
    await universeStanding(db, round.id, "ALPHA", a, 900, 1);
    await glickoRatingTrigger.onRankedRoundFinalized(db, round);
    expect(await countOpenSeasonStandings(db, season)).toBe(1);

    // Close the season, then replay the trigger: materialize must be skipped (season closed).
    await db
      .prepare("UPDATE seasons SET closed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(season)
      .run();
    await db.prepare("DELETE FROM open_season_standings WHERE season_id = ?").bind(season).run();

    await glickoRatingTrigger.onRankedRoundFinalized(db, round);
    expect(await countOpenSeasonStandings(db, season)).toBe(0);
  });

  it("scopes reads to the open season — a different season's rows are never returned", async () => {
    // Closed season 1 with cache rows; open season 2 with its own.
    const s1 = await openSeason(db);
    const a = await agent(db, "ALPHA");
    const r1 = await finalizedRound(db, "2026-06-01", s1);
    await universeStanding(db, r1.id, "ALPHA", a, 900, 1);
    await glickoRatingTrigger.onRankedRoundFinalized(db, r1);
    await db
      .prepare("UPDATE seasons SET closed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(s1)
      .run();

    const s2 = await openSeason(db);
    const b = await agent(db, "BRAVO");
    const r2 = await finalizedRound(db, "2026-06-08", s2);
    await universeStanding(db, r2.id, "BRAVO", b, 700, 1);
    await glickoRatingTrigger.onRankedRoundFinalized(db, r2);

    const s2rows = await selectOpenSeasonStandings(db, s2);
    expect(s2rows.map((r) => r.agent_id)).toEqual([b]);
    // Season 1's orphaned cache row is retained but only read when explicitly scoped to s1.
    const s1rows = await selectOpenSeasonStandings(db, s1);
    expect(s1rows.map((r) => r.agent_id)).toEqual([a]);
  });
});
