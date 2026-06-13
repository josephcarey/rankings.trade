import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudflareBindings } from "../../platform";
import type { PublicAgent, SpaceTradersClient } from "../db/snapshots-types";
import type { ScheduledScrapeOverrides } from "./scheduled";

import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import { scheduledScrape } from "./scheduled";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

const SCHEDULED_TIME = Date.UTC(2026, 5, 12, 15, 0, 0);

const AGENTS: PublicAgent[] = [
  { credits: 5000, faction: "COSMIC", shipCount: 9, symbol: "ALPHA" },
  { credits: 1000, faction: "VOID", shipCount: 2, symbol: "BRAVO" },
];

function fakeLogger(): NonNullable<ScheduledScrapeOverrides["logger"]> {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

function fakeClient(overrides: Partial<SpaceTradersClient> = {}): SpaceTradersClient {
  return {
    fetchAllAgents: () => Promise.resolve(AGENTS),
    fetchStatus: () => Promise.resolve({ resetDate: "2026-06-01" }),
    ...overrides,
  };
}

describe("scheduledScrape", () => {
  let env: CloudflareBindings;
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    db = createSqliteD1(new SQL.Database());
    await runMigrations(db, await loadMigrations(migrationsDir));
    env = { CLERK_SECRET_KEY: "test", DB: db };
  });

  async function count(): Promise<number> {
    const { results } = await db
      .prepare("SELECT COUNT(*) AS n FROM snapshots")
      .all<{ n: number }>();
    return results[0]?.n ?? 0;
  }

  it("runs a round against env.DB and logs success", async () => {
    const logger = fakeLogger();
    const summary = await scheduledScrape(
      env,
      { scheduledTime: SCHEDULED_TIME },
      { client: fakeClient(), logger },
    );

    expect(summary.agentsWritten).toBe(2);
    expect(summary.resetDate).toBe("2026-06-01");
    expect(await count()).toBe(2);
    expect(logger.info).toHaveBeenCalledWith("scrape complete", expect.any(Object));
  });

  it("logs and re-throws on failure, writing nothing", async () => {
    const logger = fakeLogger();
    const client = fakeClient({
      fetchStatus: () => Promise.reject(new Error("status 503")),
    });

    await expect(
      scheduledScrape(env, { scheduledTime: SCHEDULED_TIME }, { client, logger }),
    ).rejects.toThrow("status 503");

    expect(logger.error).toHaveBeenCalledWith(
      "scrape failed",
      expect.objectContaining({ error: "status 503" }),
    );
    expect(await count()).toBe(0);
  });

  it("runs a finalization sweep with the scraped resetDate after scraping", async () => {
    const finalize = vi.fn(() =>
      Promise.resolve({
        alreadyFinalized: [],
        finalized: [],
        noData: [],
        pendingProcessed: 0,
      }),
    );
    await scheduledScrape(
      env,
      { scheduledTime: SCHEDULED_TIME },
      { client: fakeClient(), logger: fakeLogger(), finalize },
    );
    expect(finalize).toHaveBeenCalledWith(env.DB, "2026-06-01", expect.any(Object));
  });

  it("finalizes the ended round when the universe has reset since the last round", async () => {
    // A prior round (2026-05-01) has snapshots; the live status now reports a new reset.
    await db
      .prepare(
        `INSERT INTO snapshots
           (reset_date, observed_at, agent_symbol, credits, credit_rank, total_agents, ship_count, faction)
         VALUES ('2026-05-01', '2026-05-30T00:00', 'ALPHA', 100, 1, 1, 1, 'COSMIC')`,
      )
      .run();

    const summary = await scheduledScrape(
      env,
      { scheduledTime: SCHEDULED_TIME },
      { client: fakeClient(), logger: fakeLogger() },
    );
    expect(summary.resetDate).toBe("2026-06-01");

    const round = await db
      .prepare("SELECT finalized_at FROM rounds WHERE reset_date = ?")
      .bind("2026-05-01")
      .first<{ finalized_at: string | null }>();
    expect(round?.finalized_at).not.toBeNull();
  });

  it("swallows a finalization failure so the scrape still succeeds", async () => {
    const logger = fakeLogger();
    const finalize = vi.fn(() => Promise.reject(new Error("finalize boom")));
    const summary = await scheduledScrape(
      env,
      { scheduledTime: SCHEDULED_TIME },
      { client: fakeClient(), logger, finalize },
    );
    expect(summary.agentsWritten).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(
      "finalization failed",
      expect.objectContaining({ error: "finalize boom" }),
    );
  });

  it("uses a real SpaceTraders client built from global fetch when none is injected", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v2") || url.endsWith("/v2/")) {
        return Response.json({ resetDate: "2026-07-01" });
      }
      return Response.json({ data: [], meta: { total: 0 } });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const summary = await scheduledScrape(
        env,
        { scheduledTime: SCHEDULED_TIME },
        { logger: fakeLogger() },
      );
      expect(summary.resetDate).toBe("2026-07-01");
      expect(summary.totalAgents).toBe(0);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
