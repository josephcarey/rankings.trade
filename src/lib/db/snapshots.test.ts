import Database from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSnapshotRow } from "./snapshots-types";

import { D1_MAX_BATCH } from "./constants";
import { writeSnapshots } from "./snapshots";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const SNAPSHOTS_SCHEMA = `
  CREATE TABLE snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    reset_date   TEXT    NOT NULL,
    observed_at  TEXT    NOT NULL,
    agent_symbol TEXT    NOT NULL,
    credits      INTEGER,
    credit_rank  INTEGER,
    total_agents INTEGER,
    ship_count   INTEGER,
    faction      TEXT,
    UNIQUE (reset_date, observed_at, agent_symbol)
  );
`;

function makeRow(overrides: Partial<AgentSnapshotRow> = {}): AgentSnapshotRow {
  return {
    reset_date: "2026-06-01",
    observed_at: "2026-06-12T15:00",
    agent_symbol: "AGENT-1",
    credits: 1000,
    credit_rank: 1,
    total_agents: 1,
    ship_count: 2,
    faction: "COSMIC",
    ...overrides,
  };
}

function makeRows(count: number): AgentSnapshotRow[] {
  const total = count;
  return Array.from({ length: count }, (_, i) =>
    makeRow({
      agent_symbol: `AGENT-${i}`,
      credits: count - i,
      credit_rank: i + 1,
      total_agents: total,
    }),
  );
}

describe("writeSnapshots", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(SNAPSHOTS_SCHEMA);
    db = createSqliteD1(sqliteDb);
  });

  async function count(): Promise<number> {
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM snapshots")
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  it("persists every row with its rank, totals, ship_count and faction", async () => {
    await writeSnapshots(db, [
      makeRow({ agent_symbol: "A", credits: 900, credit_rank: 1, total_agents: 2, ship_count: 7, faction: "VOID" }),
      makeRow({ agent_symbol: "B", credits: 100, credit_rank: 2, total_agents: 2, ship_count: 3, faction: "QUANTUM" }),
    ]);

    const stored = await db
      .prepare(
        "SELECT credits, credit_rank, total_agents, ship_count, faction FROM snapshots WHERE agent_symbol = ?",
      )
      .bind("A")
      .first<Omit<AgentSnapshotRow, "reset_date" | "observed_at" | "agent_symbol">>();

    expect(stored).toEqual({
      credits: 900,
      credit_rank: 1,
      total_agents: 2,
      ship_count: 7,
      faction: "VOID",
    });
    expect(await count()).toBe(2);
  });

  it("does nothing and issues no batch for an empty input", async () => {
    const batchSpy = vi.spyOn(db, "batch");
    await writeSnapshots(db, []);
    expect(batchSpy).not.toHaveBeenCalled();
    expect(await count()).toBe(0);
  });

  it("chunks writes into batches of at most 100 statements", async () => {
    const batchSpy = vi.spyOn(db, "batch");

    await writeSnapshots(db, makeRows(250));

    const chunkSizes = batchSpy.mock.calls.map((call) => call[0].length);
    expect(chunkSizes).toEqual([D1_MAX_BATCH, D1_MAX_BATCH, 50]);
    expect(await count()).toBe(250);
  });

  it("is idempotent: re-running the same observation updates in place without duplicates", async () => {
    const first = makeRow({ credits: 1000, credit_rank: 1, total_agents: 5, ship_count: 2 });
    await writeSnapshots(db, [first]);

    // Same key triple, new metric values (e.g. a re-run or a corrected capture).
    const updated = makeRow({ credits: 2500, credit_rank: 3, total_agents: 6, ship_count: 4, faction: "VOID" });
    await writeSnapshots(db, [updated]);

    expect(await count()).toBe(1);

    const row = await db
      .prepare(
        "SELECT credits, credit_rank, total_agents, ship_count, faction FROM snapshots WHERE agent_symbol = ?",
      )
      .bind("AGENT-1")
      .first<Omit<AgentSnapshotRow, "reset_date" | "observed_at" | "agent_symbol">>();

    expect(row).toEqual({
      credits: 2500,
      credit_rank: 3,
      total_agents: 6,
      ship_count: 4,
      faction: "VOID",
    });
  });

  it("keeps distinct rows for the same agent across different observations", async () => {
    await writeSnapshots(db, [
      makeRow({ observed_at: "2026-06-12T15:00" }),
      makeRow({ observed_at: "2026-06-12T15:15" }),
    ]);
    expect(await count()).toBe(2);
  });
});
