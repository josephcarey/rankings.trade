/**
 * Materialize the OPEN season's standings into the `open_season_standings` cache (audit §8.1).
 *
 * This is the WRITE half of the open-season materialization: it derives the current field with
 * {@link computeSeasonStandings} — the single source of truth for rank/title — and persists it
 * via {@link upsertOpenSeasonStandings}. Because it reuses `computeSeasonStandings` rather than
 * re-deriving ranks/titles, the cached rows are identical to a fresh compute BY CONSTRUCTION.
 *
 * Called by the rating trigger on every ranked-round finalize (where ratings change). It is
 * idempotent: a replay re-derives the live ratings and repairs the cache. It throws on failure
 * so the finalize orchestrator withholds the round's `ratings_applied_at` marker and the
 * pending-sweep retries (healing a crash between the rating apply and this write).
 */

import { upsertOpenSeasonStandings } from "../db/open-standings";
import { computeSeasonStandings } from "./standings";

/**
 * Recompute and persist the OPEN season's standings cache.
 *
 * @param roundId The ranked round whose finalize triggered this materialization (recorded for
 *   observability), or null for an out-of-band refresh.
 */
export async function materializeOpenSeasonStandings(
  db: D1Database,
  seasonId: number,
  roundId: number | null = null,
): Promise<void> {
  const standings = await computeSeasonStandings(db, seasonId);
  await upsertOpenSeasonStandings(db, seasonId, standings, roundId);
}
