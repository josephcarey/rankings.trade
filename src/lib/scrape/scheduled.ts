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
import type { ScrapeSummary } from "./run";

import { createLogger as makeLogger } from "../../logger";
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
  logger?: Logger;
}

/**
 * Run one scheduled scrape round. Logs success and re-throws on failure.
 *
 * @param env Worker bindings; only `DB` is used.
 * @param event The scheduled event (its `scheduledTime` stamps `observed_at`).
 * @param overrides Injected client/logger for tests.
 */
export async function scheduledScrape(
  env: CloudflareBindings,
  event: ScheduledScrapeEvent,
  overrides: ScheduledScrapeOverrides = {},
): Promise<ScrapeSummary> {
  const logger = overrides.logger ?? makeLogger("cron");
  const client =
    overrides.client ?? createSpaceTradersClient({ fetch: globalThis.fetch });

  try {
    return await runScrape({
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
}
