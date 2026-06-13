import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getLatestFinalizedLeagueRound,
  listLeagueCreditsSeries,
  listUniverseCreditsSeries,
} from "./credits";
import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

async function insertAgent(db: D1Database, symbol: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol) VALUES (?) RETURNING id")
    .bind(symbol)
    .first<{ id: number }>();
  return row!.id;
}

async function insertRound(
  db: D1Database,
  resetDate: string,
  opts: { finalized?: boolean; ranked?: boolean; seasonId?: null | number } = {},
): Promise<number> {
  const { finalized = true, ranked = true, seasonId = 1 } = opts;
  const row = await db
    .prepare(
      `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .bind(resetDate, seasonId, ranked ? 1 : 0, finalized ? `${resetDate}T00:00:00Z` : null)
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

async function insertStanding(
  db: D1Database,
  round: number,
  agent: { id: number; symbol: string },
  credits: null | number,
  opts: { leagueId?: null | number; rank?: number } = {},
): Promise<void> {
  const { leagueId = null, rank = 1 } = opts;
  await db
    .prepare(
      `INSERT INTO round_standings
         (round_id, league_id, agent_symbol, agent_id, final_credits, final_rank, participated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(round, leagueId, agent.symbol, agent.id, credits, rank, credits === null ? 0 : 1)
    .run();
}

describe("listUniverseCreditsSeries", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("returns an empty series when no agents are requested", async () => {
    const series = await listUniverseCreditsSeries(db, 1, []);
    expect(series.rounds).toEqual([]);
    expect(series.byAgent.size).toBe(0);
  });

  it("returns empty per-agent arrays when the season has no ranked finalized rounds", async () => {
    const a = await insertAgent(db, "ALFA");
    const series = await listUniverseCreditsSeries(db, 1, [a]);
    expect(series.rounds).toEqual([]);
    expect(series.byAgent.get(a)).toEqual([]);
  });

  it("aligns credits oldest-first and uses null for non-participation gaps", async () => {
    const a = { id: await insertAgent(db, "ALFA"), symbol: "ALFA" };
    const b = { id: await insertAgent(db, "BETA"), symbol: "BETA" };
    const r1 = await insertRound(db, "2026-01-01");
    const r2 = await insertRound(db, "2026-01-08");

    await insertStanding(db, r1, a, 100);
    await insertStanding(db, r2, a, 150);
    // BETA only appears in the second round → first column is a null gap.
    await insertStanding(db, r2, b, 90);

    const series = await listUniverseCreditsSeries(db, 1, [a.id, b.id]);
    expect(series.rounds.map((r) => r.reset_date)).toEqual([
      "2026-01-01",
      "2026-01-08",
    ]);
    expect(series.byAgent.get(a.id)).toEqual([100, 150]);
    expect(series.byAgent.get(b.id)).toEqual([null, 90]);
  });

  it("excludes league-scoped, unranked, unfinalized, and other-season rounds", async () => {
    const a = { id: await insertAgent(db, "ALFA"), symbol: "ALFA" };
    const league = await insertLeague(db, "L");
    const ranked = await insertRound(db, "2026-02-01");
    const unranked = await insertRound(db, "2026-02-08", { ranked: false });
    const pending = await insertRound(db, "2026-02-15", { finalized: false });
    const otherSeason = await insertRound(db, "2026-02-22", { seasonId: 2 });

    await insertStanding(db, ranked, a, 200); // Universe scope → included
    await insertStanding(db, ranked, a, 999, { leagueId: league }); // league scope → excluded
    await insertStanding(db, unranked, a, 1);
    await insertStanding(db, pending, a, 1);
    await insertStanding(db, otherSeason, a, 1);

    const series = await listUniverseCreditsSeries(db, 1, [a.id]);
    expect(series.rounds).toHaveLength(1);
    expect(series.byAgent.get(a.id)).toEqual([200]);
  });
});

describe("listLeagueCreditsSeries", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("returns an empty series when no agents are requested", async () => {
    const league = await insertLeague(db, "L");
    const series = await listLeagueCreditsSeries(db, league, []);
    expect(series.rounds).toEqual([]);
  });

  it("returns empty per-agent arrays when the league has no finalized rounds", async () => {
    const league = await insertLeague(db, "L");
    const a = await insertAgent(db, "ALFA");
    const series = await listLeagueCreditsSeries(db, league, [a]);
    expect(series.rounds).toEqual([]);
    expect(series.byAgent.get(a)).toEqual([]);
  });

  it("aligns league standings oldest-first with null gaps and ignores other leagues", async () => {
    const a = { id: await insertAgent(db, "ALFA"), symbol: "ALFA" };
    const league = await insertLeague(db, "L");
    const other = await insertLeague(db, "OTHER");
    const r1 = await insertRound(db, "2026-03-01");
    const r2 = await insertRound(db, "2026-03-08");
    const pending = await insertRound(db, "2026-03-15", { finalized: false });

    await insertStanding(db, r1, a, 10, { leagueId: league });
    await insertStanding(db, r2, a, 20, { leagueId: league });
    await insertStanding(db, r2, a, 777, { leagueId: other }); // different league
    await insertStanding(db, pending, a, 30, { leagueId: league }); // unfinalized

    const series = await listLeagueCreditsSeries(db, league, [a.id]);
    expect(series.rounds.map((r) => r.reset_date)).toEqual([
      "2026-03-01",
      "2026-03-08",
    ]);
    expect(series.byAgent.get(a.id)).toEqual([10, 20]);
  });
});

describe("getLatestFinalizedLeagueRound", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("returns null when the league has no finalized standings", async () => {
    const league = await insertLeague(db, "L");
    expect(await getLatestFinalizedLeagueRound(db, league)).toBeNull();
  });

  it("returns the most recent finalized round for the league", async () => {
    const a = { id: await insertAgent(db, "ALFA"), symbol: "ALFA" };
    const league = await insertLeague(db, "L");
    const r1 = await insertRound(db, "2026-04-01");
    const r2 = await insertRound(db, "2026-04-08");
    const pending = await insertRound(db, "2026-04-15", { finalized: false });
    await insertStanding(db, r1, a, 1, { leagueId: league });
    await insertStanding(db, r2, a, 2, { leagueId: league });
    await insertStanding(db, pending, a, 3, { leagueId: league });

    const latest = await getLatestFinalizedLeagueRound(db, league);
    expect(latest?.reset_date).toBe("2026-04-08");
  });
});
