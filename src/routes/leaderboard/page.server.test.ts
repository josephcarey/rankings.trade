import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "../../lib/db/loader";
import { runMigrations } from "../../lib/db/migrate";
import { insertSeason } from "../../lib/db/seasons";
import { createSqliteD1 } from "../../lib/db/sqlite-d1-adapter";
import { load } from "./+page.server";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

function platform(db: D1Database) {
  return { env: { ADMIN_CLERK_USER_IDS: "", DB: db } };
}

function invoke(db: null | D1Database) {
  return load({
    platform: db ? platform(db) : undefined,
  } as never);
}

async function insertAgent(db: D1Database, symbol: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol) VALUES (?) RETURNING id")
    .bind(symbol)
    .first<{ id: number }>();
  return row!.id;
}

async function openSeason(db: D1Database): Promise<number> {
  const season = await insertSeason(db, {
    cutoff_date: "2027-01-01",
    label: "Season 1",
    unranked_gap_days: 0,
  });
  return season.id;
}

async function insertRating(
  db: D1Database,
  agentId: number,
  seasonId: number,
  rating: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ratings (agent_id, season_id, rating, rd, volatility)
       VALUES (?, ?, ?, 40, 0.06)`,
    )
    .bind(agentId, seasonId, rating)
    .run();
}

describe("leaderboard page server load", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("returns an empty state when the platform DB is unavailable", async () => {
    const result = (await invoke(null)) as {
      chart: unknown;
      rows: unknown[];
      season: unknown;
    };
    expect(result.season).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.chart).toBeNull();
  });

  it("returns an empty state when no season is open", async () => {
    const result = (await invoke(db)) as { rows: unknown[]; season: unknown };
    expect(result.season).toBeNull();
    expect(result.rows).toEqual([]);
  });

  it("returns the open-season ranked leaderboard and a chart", async () => {
    const seasonId = await openSeason(db);
    const a = await insertAgent(db, "ALFA");
    const b = await insertAgent(db, "BETA");
    await insertRating(db, a, seasonId, 1400);
    await insertRating(db, b, seasonId, 1600);

    // A finalized ranked Universe round so the credits chart has a column.
    const round = await db
      .prepare(
        `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
         VALUES ('2026-06-01', ?, 1, '2026-06-01T00:00:00Z') RETURNING id`,
      )
      .bind(seasonId)
      .first<{ id: number }>();
    await db
      .prepare(
        `INSERT INTO round_standings
           (round_id, league_id, agent_symbol, agent_id, final_credits, final_rank, participated)
         VALUES (?, NULL, 'BETA', ?, 500, 1, 1)`,
      )
      .bind(round!.id, b)
      .run();

    const result = (await invoke(db)) as {
      chart: { hasData: boolean };
      rows: { rank: number; symbol: string }[];
      season: { label: string };
    };
    expect(result.season.label).toBe("Season 1");
    expect(result.rows.map((r) => r.symbol)).toEqual(["BETA", "ALFA"]);
    expect(result.rows[0]?.rank).toBe(1);
    expect(result.chart.hasData).toBe(true);
  });
});
