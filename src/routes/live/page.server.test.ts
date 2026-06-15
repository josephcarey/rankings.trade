import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "../../lib/db/loader";
import { runMigrations } from "../../lib/db/migrate";
import { createSqliteD1 } from "../../lib/db/sqlite-d1-adapter";
import { load } from "./+page.server";

const migrationsDir = fileURLToPath(
  new URL("../../../migrations", import.meta.url),
);

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
    setHeaders: () => {},
  } as never);
}

async function insertSnap(
  db: D1Database,
  resetDate: string,
  observedAt: string,
  symbol: string,
  credits: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO snapshots (reset_date, observed_at, agent_symbol, credits, credit_rank, ship_count)
       VALUES (?, ?, ?, ?, 1, 3)`,
    )
    .bind(resetDate, observedAt, symbol, credits)
    .run();
}

describe("live page server load", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("returns an empty state when the platform DB is unavailable", async () => {
    const result = (await invoke(null)) as {
      chart: unknown;
      resetDate: unknown;
      rows: unknown[];
    };
    expect(result.resetDate).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.chart).toBeNull();
  });

  it("returns an empty state when there are no snapshots", async () => {
    const result = (await invoke(db)) as {
      resetDate: unknown;
      rows: unknown[];
    };
    expect(result.resetDate).toBeNull();
    expect(result.rows).toEqual([]);
  });

  it("returns the current cycle's live ranking and a chart", async () => {
    // Older cycle is ignored; current cycle has two buckets.
    await insertSnap(db, "2026-06-01", "T0", "OLD", 9999);
    await insertSnap(db, "2026-06-07", "T1", "ALFA", 100);
    await insertSnap(db, "2026-06-07", "T2", "ALFA", 500);
    await insertSnap(db, "2026-06-07", "T2", "BETA", 800);

    const result = (await invoke(db)) as {
      chart: { hasData: boolean };
      defaultSymbols: string[];
      observedAts: string[];
      resetDate: string;
      rows: { rank: number; symbol: string }[];
      seriesBySymbol: Record<string, (null | number)[]>;
    };
    expect(result.resetDate).toBe("2026-06-07");
    expect(result.rows.map((r) => r.symbol)).toEqual(["BETA", "ALFA"]);
    expect(result.rows[0]?.rank).toBe(1);
    expect(result.chart.hasData).toBe(true);

    // The all-agent matrix is shipped for client-side line selection, keyed by
    // symbol and aligned to the shared observed_at axis (null gaps preserved).
    expect(result.observedAts).toEqual(["T1", "T2"]);
    expect(result.defaultSymbols).toEqual(["BETA", "ALFA"]);
    expect(result.seriesBySymbol["ALFA"]).toEqual([100, 500]);
    expect(result.seriesBySymbol["BETA"]).toEqual([null, 800]);
    // OLD belongs to a previous cycle and must not appear in the matrix.
    expect(result.seriesBySymbol["OLD"]).toBeUndefined();
  });
});
