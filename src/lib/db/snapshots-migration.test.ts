/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { AgentSnapshotRow } from "./snapshots-types";

import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";

// ---------------------------------------------------------------------------
// Minimal in-memory sql.js D1 adapter (mirrors migrate.test.ts) — enough to run
// real migrations and inspect the resulting schema via prepare().run()/first().
// ---------------------------------------------------------------------------

class SQLiteTestStatement {
  private bindings: unknown[] = [];

  constructor(
    private sql: string,
    private db: any,
  ) {}

  all(): Promise<any[]> {
    return Promise.resolve([]);
  }

  bind(...params: unknown[]) {
    this.bindings = params;
    return this;
  }

  first<T>(): Promise<T | undefined> {
    const results = this.db.exec(this.sql, this.bindings);
    if (results.length > 0 && results[0]?.values?.length > 0) {
      const columns = results[0].columns as string[];
      const values = results[0].values[0] as unknown[];
      const row: Record<string, unknown> = {};
      for (const [index, col] of columns.entries()) {
        row[col] = values[index];
      }
      return Promise.resolve(row as T);
    }
    return Promise.resolve(undefined);
  }

  run() {
    try {
      this.db.run(this.sql, this.bindings);
      return Promise.resolve({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SQL execution failed: ${message}`, { cause: error });
    }
  }
}

class SQLiteTestDatabase {
  constructor(private db: any) {}

  batch() {
    return Promise.resolve([]);
  }

  prepare(sql: string) {
    return new SQLiteTestStatement(sql, this.db);
  }
}

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

// A fully-populated snapshot row used by the persistence assertions.
const SAMPLE_ROW: AgentSnapshotRow = {
  agent_symbol: "S41N7-I",
  credit_rank: 1,
  credits: 1_234_567,
  faction: "COSMIC",
  observed_at: "2026-06-12T15:00",
  reset_date: "2026-06-01",
  ship_count: 9,
  total_agents: 4242,
};

async function insertRow(
  db: D1Database,
  row: AgentSnapshotRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO snapshots
         (reset_date, observed_at, agent_symbol, credits, credit_rank, total_agents, ship_count, faction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.reset_date,
      row.observed_at,
      row.agent_symbol,
      row.credits,
      row.credit_rank,
      row.total_agents,
      row.ship_count,
      row.faction,
    )
    .run();
}

describe("0010_snapshots migration", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;

    const migrations = await loadMigrations(migrationsDir);
    const result = await runMigrations(db, migrations);
    expect(result.success).toBe(true);
    expect(result.applied).toContain("0010_snapshots");
  });

  it("persists every snapshot column on a full row round-trip", async () => {
    await insertRow(db, SAMPLE_ROW);

    const stored = await db
      .prepare(
        `SELECT reset_date, observed_at, agent_symbol, credits, credit_rank,
                total_agents, ship_count, faction
         FROM snapshots WHERE agent_symbol = ?`,
      )
      .bind(SAMPLE_ROW.agent_symbol)
      .first<AgentSnapshotRow>();

    expect(stored).toEqual(SAMPLE_ROW);
  });

  it("enforces uniqueness on (reset_date, observed_at, agent_symbol)", async () => {
    await insertRow(db, SAMPLE_ROW);

    // Same key triple, different metric values — must be rejected by the UNIQUE constraint.
    await expect(
      insertRow(db, { ...SAMPLE_ROW, credits: 999, credit_rank: 2 }),
    ).rejects.toThrow();
  });

  it("allows the same agent in a different observation of the same round", async () => {
    await insertRow(db, SAMPLE_ROW);
    await insertRow(db, { ...SAMPLE_ROW, observed_at: "2026-06-12T15:15" });

    const count = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM snapshots WHERE agent_symbol = ?",
      )
      .bind(SAMPLE_ROW.agent_symbol)
      .first<{ n: number }>();

    expect(count?.n).toBe(2);
  });

  it("keeps ship_count and faction and drops the legacy net-worth/chart columns", async () => {
    const ddl = await db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'snapshots'")
      .first<{ sql: string }>();

    expect(ddl?.sql).toBeTruthy();
    const sql = ddl?.sql ?? "";
    expect(sql).toContain("ship_count");
    expect(sql).toContain("faction");
    expect(sql).not.toContain("net_worth");
    expect(sql).not.toContain("chart_count");
    expect(sql).not.toContain("chart_rank");
  });

  it("creates the round and agent lookup indexes", async () => {
    const agentIndex = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .bind("idx_snapshots_agent_time")
      .first<{ name: string }>();
    const resetIndex = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .bind("idx_snapshots_reset_time")
      .first<{ name: string }>();

    expect(agentIndex?.name).toBe("idx_snapshots_agent_time");
    expect(resetIndex?.name).toBe("idx_snapshots_reset_time");
  });
});
