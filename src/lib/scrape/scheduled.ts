/**
 * Cloudflare `scheduled` (cron) seam for the 15-minute scrape (Epic D, card #20).
 *
 * The Worker entry (`worker/index.ts`) is a thin declarative wrapper that cannot be unit
 * tested (it imports the build-generated `_worker.js`). All real cron behaviour lives here
 * so it can be exercised against fakes: it constructs the live SpaceTraders client, runs
 * one scrape round against `env.DB`, and logs the outcome. Failures are logged and
 * re-thrown so the Workers runtime records the invocation as failed (for retry/alerting).
 *
 * The client and logger are injectable so tests never touch the network.
 */

import type { createLogger } from "../../logger";
import type { CloudflareBindings } from "../../platform";
import type { SpaceTradersClient } from "../db/snapshots-types";
import type { FinalizationSeams } from "../rounds/seams";
import type { ScrapeSummary } from "./run";

import { createLogger as makeLogger } from "../../logger";
import { finalizePendingRounds } from "../rounds/finalize";
import { defaultFinalizationSeams } from "../rounds/seams";
import { runScrape } from "./run";
import { createSpaceTradersClient } from "./spacetraders-client";

type Logger = ReturnType<typeof createLogger>;

/** The subset of Cloudflare's `ScheduledEvent` the scrape needs. */
export interface ScheduledScrapeEvent {
  /** Epoch milliseconds of the intended cron slot. */
  scheduledTime: number;
}

/** Injectable seams for testing; production uses the defaults (live client + cron logger). */
export interface ScheduledScrapeOverrides {
  client?: SpaceTradersClient;
  /** Finalization sweep; defaults to {@link finalizePendingRounds}. */
  finalize?: typeof finalizePendingRounds;
  logger?: Logger;
  /** Finalization seams; defaults to the inert {@link defaultFinalizationSeams}. */
  seams?: FinalizationSeams;
}

/**
 * Run one scheduled scrape round, then finalize any round that has ended.
 *
 * The scrape runs first and its failure is fatal (re-thrown so the runtime records the
 * invocation as failed for retry/alerting). Finalization runs only after a successful
 * scrape, using the just-observed live `resetDate` to detect ended rounds. A
 * finalization failure is logged but NOT re-thrown: the snapshot data is already safely
 * written, and finalization is idempotent, so the next cron slot retries it cleanly
 * rather than letting a finalization bug block scraping.
 *
 * @param env Worker bindings; only `DB` is used.
 * @param event The scheduled event (its `scheduledTime` stamps `observed_at`).
 * @param overrides Injected client/logger/seams for tests.
 */
export async function scheduledScrape(
  env: CloudflareBindings,
  event: ScheduledScrapeEvent,
  overrides: ScheduledScrapeOverrides = {},
): Promise<ScrapeSummary> {
  const logger = overrides.logger ?? makeLogger("cron");
  const client =
    overrides.client ?? createSpaceTradersClient({ fetch: globalThis.fetch });
  const finalize = overrides.finalize ?? finalizePendingRounds;
  const seams = overrides.seams ?? defaultFinalizationSeams;

  let summary: ScrapeSummary;
  try {
    summary = await runScrape({
      client,
      db: env.DB,
      logger,
      scheduledTime: event.scheduledTime,
    });
  } catch (error) {
    logger.error("scrape failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  try {
    const result = await finalize(env.DB, summary.resetDate, seams);
    if (
      result.finalized.length > 0 ||
      result.noData.length > 0 ||
      result.pendingProcessed > 0
    ) {
      logger.info("finalization complete", {
        alreadyFinalized: result.alreadyFinalized.length,
        finalized: result.finalized.length,
        noData: result.noData.length,
        pendingProcessed: result.pendingProcessed,
      });
    }
  } catch (error) {
    logger.error("finalization failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return summary;
}
