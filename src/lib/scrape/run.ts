/**
 * Scrape orchestrator (Epic D, card #19).
 *
 * Ties the SpaceTraders client and the snapshot store together into one round capture:
 * read the current `resetDate`, list every public agent, assign a deterministic credit
 * rank, stamp every row with the same minute-bucketed `observed_at`, and persist via the
 * chunked idempotent store.
 *
 * Abort-on-failure: the client throws on any non-OK response or malformed status, and rows
 * are built only after BOTH fetches succeed — so a failed run writes nothing and never
 * persists a partial ranking or a wrong `total_agents`.
 *
 * All inputs are injected (client, db, the scheduled time, logger) so the whole pipeline is
 * unit-testable against fakes with no network or Worker runtime.
 */

import type { createLogger } from "../../logger";
import type { AgentSnapshotRow, SpaceTradersClient } from "../db/snapshots-types";

import { writeSnapshots } from "../db/snapshots";

type Logger = ReturnType<typeof createLogger>;

export interface RunScrapeDeps {
  client: SpaceTradersClient;
  db: D1Database;
  logger: Logger;
  /**
   * The intended cron slot as epoch milliseconds (Cloudflare's `event.scheduledTime`).
   * Bucketed to the minute for `observed_at` so delayed or retried invocations of the same
   * slot are idempotent rather than producing wall-clock-skewed duplicate rows.
   */
  scheduledTime: number;
}

export interface ScrapeSummary {
  agentsWritten: number;
  observedAt: string;
  resetDate: string;
  totalAgents: number;
}

/** Bucket an epoch-ms instant to a minute-resolution ISO key, e.g. `2026-06-12T15:00`. */
function bucketToMinute(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 16);
}

/**
 * Run one scrape round: capture every public agent's credits ranking for the current
 * reset and persist it. Returns a summary of what was written.
 *
 * @throws if the status or any agent page fetch fails — nothing is written in that case.
 */
export async function runScrape(deps: RunScrapeDeps): Promise<ScrapeSummary> {
  const { client, db, logger, scheduledTime } = deps;

  const observedAt = bucketToMinute(scheduledTime);
  const { resetDate } = await client.fetchStatus();
  const agents = await client.fetchAllAgents();
  const totalAgents = agents.length;

  const rows: AgentSnapshotRow[] = agents.map((agent, index) => ({
    agent_symbol: agent.symbol,
    credit_rank: index + 1,
    credits: agent.credits,
    faction: agent.faction,
    observed_at: observedAt,
    reset_date: resetDate,
    ship_count: agent.shipCount,
    total_agents: totalAgents,
  }));

  await writeSnapshots(db, rows);

  logger.info("scrape complete", {
    agentsWritten: rows.length,
    observedAt,
    resetDate,
    totalAgents,
  });

  return { agentsWritten: rows.length, observedAt, resetDate, totalAgents };
}
