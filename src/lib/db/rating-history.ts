/**
 * Read views over the append-only `rating_history` table (Epic O) — read-only.
 *
 * `rating_history` (migration 0017) holds one immutable row per rated agent per applied
 * ranked round (written atomically by src/lib/db/ratings.ts applyRatingPeriod). These helpers
 * shape it into the two public surfaces:
 *
 *   - the rating-over-time chart (an agent's season timeline, oldest round first), and
 *   - rank/rating deltas "since last round" (an agent's, or the whole leaderboard's, two most
 *     recent rows — see src/lib/ratings/delta.ts for the pure delta maths).
 *
 * Everything here is OPEN-SEASON scoped by the caller (DEC-I2): a `season_id` is required, so
 * a closed season's retained history never leaks into the live "current" surfaces. Rows are
 * ordered by the round's `reset_date` (domain time), not insert time, joining `rounds`.
 */

import type { DeltaPoint, RatingDelta } from "../ratings/delta";

import { computeDelta } from "../ratings/delta";

/** One point on an agent's rating timeline. */
export interface RatingHistoryPoint {
  readonly resetDate: string;
  readonly rating: number;
  readonly rank: number;
}

interface HistoryRow {
  rating: number;
  rank: number;
  reset_date: string;
}

/**
 * An agent's full rating timeline for one season, oldest round first (chart x-axis order).
 * Empty when the agent has no history in the season.
 */
export async function listAgentRatingHistory(
  db: D1Database,
  agentId: number,
  seasonId: number,
): Promise<RatingHistoryPoint[]> {
  const { results } = await db
    .prepare(
      `SELECT rh.rating AS rating, rh.rank AS rank, r.reset_date AS reset_date
       FROM rating_history rh
       JOIN rounds r ON r.id = rh.round_id
       WHERE rh.agent_id = ? AND rh.season_id = ?
       ORDER BY r.reset_date ASC, rh.round_id ASC`,
    )
    .bind(agentId, seasonId)
    .all<HistoryRow>();
  return (results ?? []).map((row) => ({
    rating: row.rating,
    rank: row.rank,
    resetDate: row.reset_date,
  }));
}

/**
 * One agent's rank/rating delta since the previous ranked round in the season, or null when
 * the agent has fewer than two history rows (a new entrant — no fake arrow).
 */
export async function getAgentRatingDelta(
  db: D1Database,
  agentId: number,
  seasonId: number,
): Promise<RatingDelta | null> {
  const { results } = await db
    .prepare(
      `SELECT rh.rating AS rating, rh.rank AS rank, r.reset_date AS reset_date
       FROM rating_history rh
       JOIN rounds r ON r.id = rh.round_id
       WHERE rh.agent_id = ? AND rh.season_id = ?
       ORDER BY r.reset_date DESC, rh.round_id DESC
       LIMIT 2`,
    )
    .bind(agentId, seasonId)
    .all<HistoryRow>();
  const rows = results ?? [];
  return computeDelta(rows[0], rows[1]);
}

/**
 * Every agent's delta for the leaderboard, keyed by agent id. Because applyRatingPeriod
 * writes a history row for EVERY rated agent each period (participants ∪ idle), the "two most
 * recent rounds" is a single global pair, so deltas are derived from the season's latest two
 * rounds. An agent present only in the latest round (a brand-new entrant) has no delta and is
 * absent from the map.
 */
export async function listSeasonRoundDeltas(
  db: D1Database,
  seasonId: number,
): Promise<Map<number, RatingDelta>> {
  // The two most recent rounds in this season that have history rows.
  const roundRows = await db
    .prepare(
      `SELECT rh.round_id AS round_id
       FROM rating_history rh
       JOIN rounds r ON r.id = rh.round_id
       WHERE rh.season_id = ?
       GROUP BY rh.round_id, r.reset_date
       ORDER BY r.reset_date DESC, rh.round_id DESC
       LIMIT 2`,
    )
    .bind(seasonId)
    .all<{ round_id: number }>();
  const rounds = roundRows.results ?? [];
  const deltas = new Map<number, RatingDelta>();
  if (rounds.length < 2) return deltas;

  const [latestRoundId, prevRoundId] = [rounds[0]!.round_id, rounds[1]!.round_id];
  const latest = await pointsByAgent(db, seasonId, latestRoundId);
  const previous = await pointsByAgent(db, seasonId, prevRoundId);

  for (const [agentId, latestPoint] of latest) {
    const delta = computeDelta(latestPoint, previous.get(agentId));
    if (delta) deltas.set(agentId, delta);
  }
  return deltas;
}

/** All history rows for one round in a season, keyed by agent id. */
async function pointsByAgent(
  db: D1Database,
  seasonId: number,
  roundId: number,
): Promise<Map<number, DeltaPoint>> {
  const { results } = await db
    .prepare(
      `SELECT agent_id AS agent_id, rating AS rating, rank AS rank
       FROM rating_history
       WHERE season_id = ? AND round_id = ?`,
    )
    .bind(seasonId, roundId)
    .all<{ agent_id: number; rating: number; rank: number }>();
  return new Map(
    (results ?? []).map((row) => [
      row.agent_id,
      { rating: row.rating, rank: row.rank },
    ]),
  );
}
