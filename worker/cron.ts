import type { CloudflareBindings } from "../src/platform";

import { scheduledScrape } from "../src/lib/scrape/scheduled";

/**
 * Dedicated cron Worker for the 15-minute scrape (Epic D, card #20).
 *
 * This is a SEPARATE Worker from the SvelteKit app: @sveltejs/adapter-cloudflare v7
 * overwrites whatever wrangler.toml's main points at with its own generated fetch-only
 * worker, so there is no way to add a scheduled handler to the app worker without fighting
 * the adapter. A standalone worker that shares the same D1 binding cleanly sidesteps that
 * (and the app's unrelated bundle), and is independently deployable via wrangler.cron.toml
 * (bun run deploy:cron).
 *
 * All real logic lives in the tested scheduledScrape seam. scheduled awaits it so a thrown
 * scrape marks the cron invocation as failed for Cloudflare retry/alerting.
 */
export default {
  async scheduled(
    event: ScheduledEvent,
    env: CloudflareBindings,
  ): Promise<void> {
    await scheduledScrape(env, event);
  },
};
