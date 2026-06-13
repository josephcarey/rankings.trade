/**
 * Typed query helpers for the `ratings` and `rating_periods` tables (Epic H).
 *
 * These are the persistence primitives the rating trigger (`src/lib/ratings/trigger.ts`)
 * composes. The rating maths is pure and lives in `src/lib/ratings/` — this module only
 * reads current season state and writes the result of one applied rating period.
 *
 * Idempotency model (see migrations/0011_ratings.sql and trigger.ts):
 *   - {@link isRatingPeriodApplied} is the dedupe precheck. The Epic G orchestrator can
 *     re-invoke the trigger after a crash that happened after the rating writes committed
 *     but before `rounds.ratings_applied_at` was set; the marker row written by
 *     {@link applyRatingPeriod} makes that replay a no-op.
 *   - {@link hasEarlierUnappliedRankedRound} is the chronological barrier. The orchestrator
 *     can finalize+apply a LATER round before replaying an earlier pending one; since
 *     Glicko-2 updates are order-dependent, the trigger refuses to apply a round while an
 *     earlier ranked round in the same season is still unapplied, so the pending-trigger
 *     sweep (which runs in id order) heals the ordering on the next pass.
 *
 * Reads against `rounds` (Epic G) are read-only — this module never mutates another
 * epic's tables.
 */

import { D1_MAX_BATCH } from "./snapshots";

/** A stored rating row for one agent in one season. */
export type RatingRow = {
  agent_id: number;
  season_id: number;
  rating: number;
  rd: number;
  volatility: number;
  last_round_id: number | null;
};

/** The new state to persist for one agent at the end of a rating period. */
export type RatingUpdate = {
  agentId: number;
  rating: number;
  rd: number;
  volatility: number;
};

const UPSERT_RATING_SQL = `
  INSERT INTO ratings (agent_id, season_id, rating, rd, volatility, last_round_id, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT (agent_id, season_id) DO UPDATE SET
    rating = excluded.rating,
    rd = excluded.rd,
    volatility = excluded.volatility,
    last_round_id = excluded.last_round_id,
    updated_at = CURRENT_TIMESTAMP`;

const INSERT_MARKER_SQL = `INSERT INTO rating_periods (round_id, season_id) VALUES (?, ?)`;

/** Every rating row in a season (the input set for participants + idle non-participants). */
export async function listSeasonRatings(
  db: D1Database,
  seasonId: number,
): Promise<RatingRow[]> {
  const { results } = await db
    .prepare(
      `SELECT agent_id, season_id, rating, rd, volatility, last_round_id
       FROM ratings WHERE season_id = ?`,
    )
    .bind(seasonId)
    .all<RatingRow>();
  return results ?? [];
}

/** One agent's current season rating, or null if unrated this season. */
export async function getRating(
  db: D1Database,
  agentId: number,
  seasonId: number,
): Promise<RatingRow | null> {
  return db
    .prepare(
      `SELECT agent_id, season_id, rating, rd, volatility, last_round_id
       FROM ratings WHERE agent_id = ? AND season_id = ?`,
    )
    .bind(agentId, seasonId)
    .first<RatingRow>();
}

/** True once a round's rating period has been applied (the idempotency dedupe key). */
export async function isRatingPeriodApplied(
  db: D1Database,
  roundId: number,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS present FROM rating_periods WHERE round_id = ? LIMIT 1`)
    .bind(roundId)
    .first<{ present: number }>();
  return row !== null;
}

/**
 * True if some earlier (by reset_date) finalized ranked round in the same season has not
 * had its rating period applied yet — the chronological barrier described above.
 */
export async function hasEarlierUnappliedRankedRound(
  db: D1Database,
  seasonId: number,
  resetDate: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM rounds r
       WHERE r.season_id = ?
         AND r.is_ranked = 1
         AND r.finalized_at IS NOT NULL
         AND r.reset_date < ?
         AND NOT EXISTS (SELECT 1 FROM rating_periods rp WHERE rp.round_id = r.id)
       LIMIT 1`,
    )
    .bind(seasonId, resetDate)
    .first<{ present: number }>();
  return row !== null;
}

/**
 * Persist one applied rating period: every agent's new state plus the `rating_periods`
 * marker, so a replay is a no-op. The marker is written in the final batch after the
 * rating upserts. Writes are chunked to respect D1's per-batch statement limit; within a
 * single batch D1 is atomic.
 */
export async function applyRatingPeriod(
  db: D1Database,
  args: { roundId: number; seasonId: number; updates: readonly RatingUpdate[] },
): Promise<void> {
  const { roundId, seasonId, updates } = args;

  const ratingStmt = db.prepare(UPSERT_RATING_SQL);
  const statements = updates.map((u) =>
    ratingStmt.bind(u.agentId, seasonId, u.rating, u.rd, u.volatility, roundId),
  );
  statements.push(db.prepare(INSERT_MARKER_SQL).bind(roundId, seasonId));

  for (let i = 0; i < statements.length; i += D1_MAX_BATCH) {
    await db.batch(statements.slice(i, i + D1_MAX_BATCH));
  }
}
