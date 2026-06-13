/**
 * Rank & rating delta computation (Epic O) — pure, no DB.
 *
 * A delta is the movement between an agent's two most recent per-round rating-history rows
 * (src/lib/db/rating-history.ts) within the open season:
 *
 *   - `ratingDelta` = latest.rating − previous.rating (positive = rating went up).
 *   - `rankDelta`   = previous.rank − latest.rank (positive = PROMOTED, i.e. moved toward
 *     rank #1, since a lower rank number is better). This sign convention lets the UI map a
 *     positive value straight to an "up"/promotion arrow for both rating and rank.
 *
 * "No previous row" (a brand-new entrant with a single history row, or an empty history) is
 * NOT a zero/▲0 delta — it returns `null`, so the UI shows no arrow rather than a fake one.
 */

/** A single rating-history point (newest-relevant fields only). */
export interface DeltaPoint {
  readonly rating: number;
  readonly rank: number;
}

/** The movement since the previous ranked round. */
export interface RatingDelta {
  readonly ratingDelta: number;
  readonly rankDelta: number;
}

/**
 * Compute the delta from an agent's two most recent history points.
 *
 * @param latest the newest history point, or null/undefined when the agent has no history.
 * @param previous the point before it, or null/undefined when there is no earlier round.
 * @returns the delta, or null when there is no previous point (new entrant).
 */
export function computeDelta(
  latest: DeltaPoint | null | undefined,
  previous: DeltaPoint | null | undefined,
): RatingDelta | null {
  if (!latest || !previous) return null;
  return {
    ratingDelta: latest.rating - previous.rating,
    rankDelta: previous.rank - latest.rank,
  };
}
