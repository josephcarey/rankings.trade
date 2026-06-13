import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "../../lib/db/loader";
import { runMigrations } from "../../lib/db/migrate";
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
  return load({ platform: db ? platform(db) : undefined } as never);
}

async function insertAgent(db: D1Database, symbol: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol) VALUES (?) RETURNING id")
    .bind(symbol)
    .first<{ id: number }>();
  return row!.id;
}

/** Insert a season; `closed` stamps `closed_at` so it counts as archived. */
async function insertSeason(
  db: D1Database,
  label: string,
  closed: boolean,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO seasons (label, cutoff_date, unranked_gap_days, closed_at)
       VALUES (?, '2027-01-01', 0, ?)
       RETURNING id`,
    )
    .bind(label, closed ? "2027-01-02T00:00:00Z" : null)
    .first<{ id: number }>();
  return row!.id;
}

async function insertStanding(
  db: D1Database,
  seasonId: number,
  agentId: number,
  rank: number,
  rating: number,
  title: null | string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO season_standings
         (season_id, agent_id, final_rating, final_rd, final_volatility,
          final_rank, title, established, ranked_rounds)
       VALUES (?, ?, ?, 40, 0.06, ?, ?, 1, 5)`,
    )
    .bind(seasonId, agentId, rating, rank, title)
    .run();
}

type Loaded = {
  seasons: {
    seasonId: number;
    label: string;
    champions: { symbol: string }[];
    podium: { symbol: string; rank: number }[];
  }[];
};

describe("hall of fame page server load", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("returns an empty list when the platform DB is unavailable", async () => {
    const result = (await invoke(null)) as Loaded;
    expect(result.seasons).toEqual([]);
  });

  it("returns an empty list when no season has closed", async () => {
    const result = (await invoke(db)) as Loaded;
    expect(result.seasons).toEqual([]);
  });

  it("lists each closed season's podium, champion first, newest season first", async () => {
    const s1 = await insertSeason(db, "Season 1", true);
    const s2 = await insertSeason(db, "Season 2", true);
    const win = await insertAgent(db, "WINNER");
    const run = await insertAgent(db, "RUNNER");
    const thr = await insertAgent(db, "THIRD");
    const low = await insertAgent(db, "FOURTH");
    // Season 1 full podium + a 4th-place agent that must be excluded.
    await insertStanding(db, s1, win, 1, 1800, "Admiral");
    await insertStanding(db, s1, run, 2, 1700, "Colonel");
    await insertStanding(db, s1, thr, 3, 1600, "Commodore");
    await insertStanding(db, s1, low, 4, 1500, null);
    // Season 2 champion only.
    await insertStanding(db, s2, win, 1, 1900, "Fleet Admiral");

    const result = (await invoke(db)) as Loaded;
    expect(result.seasons.map((s) => s.label)).toEqual(["Season 2", "Season 1"]);

    const season1 = result.seasons[1]!;
    expect(season1.podium.map((p) => p.symbol)).toEqual([
      "WINNER",
      "RUNNER",
      "THIRD",
    ]);
    expect(season1.podium.every((p) => p.rank <= 3)).toBe(true);
    expect(season1.champions.map((c) => c.symbol)).toEqual(["WINNER"]);
  });

  it("never surfaces an open season's standings (immutability)", async () => {
    const open = await insertSeason(db, "Open Season", false);
    const a = await insertAgent(db, "LEADER");
    await insertStanding(db, open, a, 1, 1800, "Admiral");

    const result = (await invoke(db)) as Loaded;
    expect(result.seasons).toEqual([]);
  });

  it("surfaces co-champions on a tie at rank 1", async () => {
    const s = await insertSeason(db, "Tie Season", true);
    const a = await insertAgent(db, "COA");
    const b = await insertAgent(db, "COB");
    const c = await insertAgent(db, "BRONZE");
    await insertStanding(db, s, a, 1, 1800, "Admiral");
    await insertStanding(db, s, b, 1, 1800, "Admiral");
    await insertStanding(db, s, c, 3, 1600, "Colonel");

    const result = (await invoke(db)) as Loaded;
    expect(result.seasons[0]!.champions.map((c2) => c2.symbol).toSorted()).toEqual([
      "COA",
      "COB",
    ]);
    expect(result.seasons[0]!.podium).toHaveLength(3);
  });
});
