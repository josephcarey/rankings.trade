/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { createSqliteD1 } from "./sqlite-d1-adapter";
import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

/** Apply every shipped migration to a fresh in-memory SQLite and return a D1 facade. */
async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  expect(result.applied).toContain("0008_rounds");
  return db;
}

/** Seed a Universe round we can hang standings off of. Returns its id. */
async function insertRound(db: D1Database, resetDate: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO rounds (reset_date) VALUES (?) RETURNING id")
    .bind(resetDate)
    .first<{ id: number }>();
  return row!.id;
}

describe("0008_rounds migration", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("applies cleanly behind the shipped 0010 snapshots migration", async () => {
    const tables = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rounds','round_standings') ORDER BY name",
      )
      .all<{ name: string }>();
    expect(tables.results.map((r) => r.name)).toEqual(["round_standings", "rounds"]);
  });

  it("defaults a new round to unranked with no season and no finalize markers", async () => {
    await insertRound(db, "2026-06-01");
    const round = await db
      .prepare("SELECT * FROM rounds WHERE reset_date = ?")
      .bind("2026-06-01")
      .first<Record<string, unknown>>();
    expect(round?.is_ranked).toBe(0);
    expect(round?.season_id).toBeNull();
    expect(round?.finalized_at).toBeNull();
    expect(round?.membership_frozen_at).toBeNull();
    expect(round?.ratings_applied_at).toBeNull();
    expect(round?.season_processed_at).toBeNull();
  });

  it("enforces one round per reset_date", async () => {
    await insertRound(db, "2026-06-01");
    await expect(insertRound(db, "2026-06-01")).rejects.toThrow();
  });

  it("rejects a ranked round without a season (ranked ⇒ season invariant)", async () => {
    const attempt = async (): Promise<void> => {
      await db
        .prepare("INSERT INTO rounds (reset_date, is_ranked, season_id) VALUES (?, 1, NULL)")
        .bind("2026-06-02")
        .run();
    };
    await expect(attempt()).rejects.toThrow();
  });

  it("allows a ranked round once a concrete season is attached", async () => {
    await db
      .prepare("INSERT INTO rounds (reset_date, is_ranked, season_id) VALUES (?, 1, 7)")
      .bind("2026-06-03")
      .run();
    const round = await db
      .prepare("SELECT is_ranked, season_id FROM rounds WHERE reset_date = ?")
      .bind("2026-06-03")
      .first<{ is_ranked: number; season_id: number }>();
    expect(round).toEqual({ is_ranked: 1, season_id: 7 });
  });

  async function insertStanding(
    db: D1Database,
    roundId: number,
    leagueId: number | null,
    symbol: string,
    rank: number,
  ): Promise<void> {
    await db
      .prepare(
        "INSERT INTO round_standings (round_id, league_id, agent_symbol, final_rank) VALUES (?, ?, ?, ?)",
      )
      .bind(roundId, leagueId, symbol, rank)
      .run();
  }

  it("deduplicates Universe standings per (round, agent) despite NULL league_id", async () => {
    const roundId = await insertRound(db, "2026-06-01");
    await insertStanding(db, roundId, null, "ALPHA", 1);
    await expect(insertStanding(db, roundId, null, "ALPHA", 2)).rejects.toThrow();
  });

  it("deduplicates league standings per (round, league, agent)", async () => {
    const roundId = await insertRound(db, "2026-06-01");
    await insertStanding(db, roundId, 5, "ALPHA", 1);
    await expect(insertStanding(db, roundId, 5, "ALPHA", 2)).rejects.toThrow();
  });

  it("lets the same agent stand in the Universe and in several leagues at once", async () => {
    const roundId = await insertRound(db, "2026-06-01");
    await insertStanding(db, roundId, null, "ALPHA", 1);
    await insertStanding(db, roundId, 5, "ALPHA", 1);
    await insertStanding(db, roundId, 6, "ALPHA", 1);
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM round_standings WHERE agent_symbol = ?")
      .bind("ALPHA")
      .first<{ n: number }>();
    expect(count?.n).toBe(3);
  });
});
