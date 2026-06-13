import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { SeasonStandingInsert } from "./seasons";

import { buildLeaderboard, toLeaderboardRow } from "./leaderboard";
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

async function insertRating(
  db: D1Database,
  agentId: number,
  rating: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ratings (agent_id, season_id, rating, rd, volatility)
       VALUES (?, 1, ?, 40, 0.06)`,
    )
    .bind(agentId, rating)
    .run();
}

describe("toLeaderboardRow", () => {
  it("maps a season standing and symbol into a render-ready row", () => {
    const standing: SeasonStandingInsert = {
      agent_id: 7,
      established: true,
      final_rank: 3,
      final_rating: 1512,
      final_rd: 45,
      final_volatility: 0.06,
      ranked_rounds: 9,
      season_id: 1,
      title: "Captain",
    };
    expect(toLeaderboardRow(standing, "ZORP")).toEqual({
      agentId: 7,
      established: true,
      rank: 3,
      rankedRounds: 9,
      rating: 1512,
      rd: 45,
      symbol: "ZORP",
      title: "Captain",
    });
  });
});

describe("buildLeaderboard", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("returns an empty array when the season has no rated agents", async () => {
    expect(await buildLeaderboard(db, 1)).toEqual([]);
  });

  it("ranks agents by rating descending with their callsigns", async () => {
    const a = await insertAgent(db, "ALFA");
    const b = await insertAgent(db, "BETA");
    const c = await insertAgent(db, "GAMA");
    await insertRating(db, a, 1400);
    await insertRating(db, b, 1600);
    await insertRating(db, c, 1500);

    const rows = await buildLeaderboard(db, 1);
    expect(rows.map((r) => r.symbol)).toEqual(["BETA", "GAMA", "ALFA"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0]?.rating).toBe(1600);
  });

  it("uses competition ranking so tied ratings share a rank", async () => {
    const a = await insertAgent(db, "ALFA");
    const b = await insertAgent(db, "BETA");
    const c = await insertAgent(db, "GAMA");
    await insertRating(db, a, 1500);
    await insertRating(db, b, 1500);
    await insertRating(db, c, 1400);

    const rows = await buildLeaderboard(db, 1);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
});
