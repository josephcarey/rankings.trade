import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  expect(result.applied).toContain("0011_ratings");
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
  seasonId: number,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO ratings (agent_id, season_id, rating, rd, volatility) VALUES (?, ?, 1500, 350, 0.06)",
    )
    .bind(agentId, seasonId)
    .run();
}

describe("0011_ratings migration", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("creates the ratings and rating_periods tables", async () => {
    const tables = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ratings','rating_periods') ORDER BY name",
      )
      .all<{ name: string }>();
    expect(tables.results.map((r) => r.name)).toEqual(["rating_periods", "ratings"]);
  });

  it("keys a rating uniquely per (agent, season)", async () => {
    const agentId = await insertAgent(db, "ALPHA");
    await insertRating(db, agentId, 1);
    await expect(insertRating(db, agentId, 1)).rejects.toThrow();
  });

  it("lets one agent hold a separate rating in each season", async () => {
    const agentId = await insertAgent(db, "ALPHA");
    await insertRating(db, agentId, 1);
    await insertRating(db, agentId, 2);
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM ratings WHERE agent_id = ?")
      .bind(agentId)
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("defaults last_round_id to NULL", async () => {
    const agentId = await insertAgent(db, "ALPHA");
    await insertRating(db, agentId, 1);
    const row = await db
      .prepare("SELECT last_round_id FROM ratings WHERE agent_id = ?")
      .bind(agentId)
      .first<{ last_round_id: number | null }>();
    expect(row?.last_round_id).toBeNull();
  });

  it("enforces one rating_periods marker per round_id", async () => {
    await db
      .prepare("INSERT INTO rating_periods (round_id, season_id) VALUES (1, 1)")
      .run();
    await expect(
      (async () =>
        db.prepare("INSERT INTO rating_periods (round_id, season_id) VALUES (1, 1)").run())(),
    ).rejects.toThrow();
  });
});
