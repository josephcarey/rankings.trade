/**
 * Shared competition-ranking helper (Epic O) — pure, no DB.
 *
 * Standard competition ranking ("1224") over a rated population by rating DESCENDING: equal
 * ratings share a rank and the next rank skips accordingly. Ties are ordered by agent id
 * ascending purely for determinism (it never affects the assigned rank, since tied ratings
 * share one rank).
 *
 * This is the single source of truth for "rank within a season's rated population". Both the
 * live leaderboard standings (Epic I, src/lib/seasons/standings.ts) and the per-round rating
 * history (Epic O, src/lib/ratings/trigger.ts) rank through it, so an agent's stored history
 * rank for the latest round is guaranteed identical to its displayed leaderboard rank — which
 * is what makes the rank deltas exact.
 */

/** One agent's id and rating for ranking. */
export interface RankInput {
  readonly agentId: number;
  readonly rating: number;
}

/**
 * Competition-rank a rated population by rating desc.
 *
 * @returns a map of agentId → rank (1-based). Empty when given no inputs. Duplicate agent
 *   ids are not expected (one rating per agent per season) and the last one would win.
 */
export function rankByRatingDesc(
  inputs: readonly RankInput[],
): Map<number, number> {
  const sorted = [...inputs].toSorted(
    (a, b) => b.rating - a.rating || a.agentId - b.agentId,
  );
  const ranks = new Map<number, number>();
  for (const [i, entry] of sorted.entries()) {
    const rank =
      i > 0 && entry.rating === sorted[i - 1]!.rating
        ? ranks.get(sorted[i - 1]!.agentId)!
        : i + 1;
    ranks.set(entry.agentId, rank);
  }
  return ranks;
}
