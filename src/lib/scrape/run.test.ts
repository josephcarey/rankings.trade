import Database from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicAgent, SpaceTradersClient } from "../db/snapshots-types";
import type { RunScrapeDeps } from "./run";

import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import { runScrape } from "./run";

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

// 2026-06-12T15:00:37Z — proves observed_at is bucketed to the minute, dropping seconds.
const SCHEDULED_TIME = Date.UTC(2026, 5, 12, 15, 0, 37, 500);
const OBSERVED_AT = "2026-06-12T15:00";

function fakeLogger(): RunScrapeDeps["logger"] {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function fakeClient(overrides: Partial<SpaceTradersClient> = {}): SpaceTradersClient {
  return {
    fetchAllAgents: () => Promise.resolve([]),
    fetchStatus: () => Promise.resolve({ resetDate: "2026-06-01" }),
    ...overrides,
  };
}

// Client contract is "already sorted credits desc, symbol asc"; mirror that here.
const AGENTS: PublicAgent[] = [
  { credits: 5000, faction: "COSMIC", shipCount: 9, symbol: "ALPHA" },
  { credits: 3000, faction: "VOID", shipCount: 4, symbol: "BRAVO" },
  { credits: 1000, faction: "QUANTUM", shipCount: 2, symbol: "CHARLIE" },
];

describe("runScrape", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(SNAPSHOTS_SCHEMA);
    db = createSqliteD1(sqliteDb);
  });

  async function storedRows() {
    const { results } = await db
      .prepare(
        "SELECT agent_symbol, credit_rank, credits, total_agents, ship_count, faction, reset_date, observed_at FROM snapshots ORDER BY credit_rank ASC",
      )
      .all();
    return results;
  }

  it("captures the round: ranks by client order, stamps reset/observed, persists every agent", async () => {
    const client = fakeClient({ fetchAllAgents: () => Promise.resolve(AGENTS) });
    const summary = await runScrape({ client, db, logger: fakeLogger(), scheduledTime: SCHEDULED_TIME });

    expect(summary).toEqual({
      agentsWritten: 3,
      observedAt: OBSERVED_AT,
      resetDate: "2026-06-01",
      totalAgents: 3,
    });

    expect(await storedRows()).toEqual([
      { agent_symbol: "ALPHA", credit_rank: 1, credits: 5000, total_agents: 3, ship_count: 9, faction: "COSMIC", reset_date: "2026-06-01", observed_at: OBSERVED_AT },
      { agent_symbol: "BRAVO", credit_rank: 2, credits: 3000, total_agents: 3, ship_count: 4, faction: "VOID", reset_date: "2026-06-01", observed_at: OBSERVED_AT },
      { agent_symbol: "CHARLIE", credit_rank: 3, credits: 1000, total_agents: 3, ship_count: 2, faction: "QUANTUM", reset_date: "2026-06-01", observed_at: OBSERVED_AT },
    ]);
  });

  it("is idempotent across re-runs of the same slot (same observed_at upserts in place)", async () => {
    const deps = { client: fakeClient({ fetchAllAgents: () => Promise.resolve(AGENTS) }), db, logger: fakeLogger(), scheduledTime: SCHEDULED_TIME };
    await runScrape(deps);
    await runScrape(deps);

    const { results } = await db.prepare("SELECT COUNT(*) AS n FROM snapshots").all<{ n: number }>();
    expect(results[0]?.n).toBe(3);
  });

  it("aborts with no DB writes when the status fetch fails", async () => {
    const client = fakeClient({
      fetchAllAgents: vi.fn(() => Promise.resolve(AGENTS)),
      fetchStatus: () => Promise.reject(new Error("status 503")),
    });
    const batchSpy = vi.spyOn(db, "batch");

    await expect(
      runScrape({ client, db, logger: fakeLogger(), scheduledTime: SCHEDULED_TIME }),
    ).rejects.toThrow("status 503");

    expect(client.fetchAllAgents).not.toHaveBeenCalled();
    expect(batchSpy).not.toHaveBeenCalled();
    expect(await storedRows()).toEqual([]);
  });

  it("aborts with no DB writes when an agent page fetch fails", async () => {
    const client = fakeClient({
      fetchAllAgents: () => Promise.reject(new Error("agents page 2 failed")),
    });
    const batchSpy = vi.spyOn(db, "batch");

    await expect(
      runScrape({ client, db, logger: fakeLogger(), scheduledTime: SCHEDULED_TIME }),
    ).rejects.toThrow("agents page 2 failed");

    expect(batchSpy).not.toHaveBeenCalled();
    expect(await storedRows()).toEqual([]);
  });

  it("handles an empty agent list without issuing a batch", async () => {
    const logger = fakeLogger();
    const batchSpy = vi.spyOn(db, "batch");

    const summary = await runScrape({ client: fakeClient(), db, logger, scheduledTime: SCHEDULED_TIME });

    expect(summary.agentsWritten).toBe(0);
    expect(summary.totalAgents).toBe(0);
    expect(batchSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("scrape complete", expect.objectContaining({ totalAgents: 0 }));
  });
});
