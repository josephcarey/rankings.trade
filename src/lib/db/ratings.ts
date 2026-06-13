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

/**
 * One append-only `rating_history` row for an agent at the end of a rating period (Epic O).
 * `season_id`/`round_id` are bound by {@link applyRatingPeriod} (not carried here) so history
 * and the rating UPSERTs can never be written against a mismatched round/season.
 */
export type RatingHistoryInsert = {
  agentId: number;
  rating: number;
  rd: number;
  rank: number;
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

/** Column tuple bound, in order, for one `rating_history` row. */
const HISTORY_COLUMNS = `(agent_id, season_id, round_id, rating, rd, rank)`;

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
 * Persist one applied rating period: every agent's new state, an append-only
 * `rating_history` row per agent (Epic O), and the `rating_periods` marker — ALL written in
 * a SINGLE atomic `db.batch()` so a replay (which reruns the whole computation) is an
 * all-or-nothing no-op and history can never disagree with the current rating.
 *
 * The whole period must fit in one D1 batch (≤ {@link D1_MAX_BATCH} statements) to stay
 * atomic. If a season ever exceeds that, splitting across batches would leave ratings written
 * without the marker — a later replay would then recompute from already-mutated states and
 * double-apply. Rather than corrupt silently, this throws so the failure is loud; a
 * multi-batch-safe apply (e.g. a pre-period snapshot) is the follow-up. The statement count is
 * the N rating UPSERTs + 1 marker + 1 (a SINGLE multi-row history insert, when history is
 * supplied), so the ceiling stays at ~{@link D1_MAX_BATCH} agents rather than halving it.
 *
 * History rows (when supplied) must describe EXACTLY the same agents as `updates` — same
 * count, same ids, no duplicates — so the round's current ratings and its history can never
 * be silently written for different populations. `season_id`/`round_id` are bound here, not
 * trusted from the caller's rows. Callers that only exercise rating mechanics may omit
 * `history`; production always supplies it.
 */
export async function applyRatingPeriod(
  db: D1Database,
  args: {
    roundId: number;
    seasonId: number;
    updates: readonly RatingUpdate[];
    history?: readonly RatingHistoryInsert[];
  },
): Promise<void> {
  const { roundId, seasonId, updates, history = [] } = args;

  if (history.length > 0) assertHistoryMatchesUpdates(updates, history);

  // N upserts + (1 multi-row history insert when present) + 1 marker, all atomic.
  const statementCount = updates.length + (history.length > 0 ? 1 : 0) + 1;
  if (statementCount > D1_MAX_BATCH) {
    throw new Error(
      `applyRatingPeriod: rating period too large for a single atomic batch ` +
        `(${updates.length} agents ⇒ ${statementCount} statements > ${D1_MAX_BATCH}); ` +
        `needs a multi-batch-safe apply`,
    );
  }

  const ratingStmt = db.prepare(UPSERT_RATING_SQL);
  const statements = updates.map((u) =>
    ratingStmt.bind(u.agentId, seasonId, u.rating, u.rd, u.volatility, roundId),
  );

  if (history.length > 0) {
    const placeholders = history.map(() => `(?, ?, ?, ?, ?, ?)`).join(", ");
    const bindings = history.flatMap((h) => [
      h.agentId,
      seasonId,
      roundId,
      h.rating,
      h.rd,
      h.rank,
    ]);
    statements.push(
      db
        .prepare(`INSERT INTO rating_history ${HISTORY_COLUMNS} VALUES ${placeholders}`)
        .bind(...bindings),
    );
  }

  statements.push(db.prepare(INSERT_MARKER_SQL).bind(roundId, seasonId));

  await db.batch(statements);
}

/** Fail loud if history does not describe exactly the same agents as the rating updates. */
function assertHistoryMatchesUpdates(
  updates: readonly RatingUpdate[],
  history: readonly RatingHistoryInsert[],
): void {
  const updateIds = new Set(updates.map((u) => u.agentId));
  const seen = new Set<number>();
  for (const h of history) {
    if (!updateIds.has(h.agentId)) {
      throw new Error(
        `applyRatingPeriod: history row for agent ${h.agentId} has no matching rating update`,
      );
    }
    if (seen.has(h.agentId)) {
      throw new Error(
        `applyRatingPeriod: duplicate history row for agent ${h.agentId}`,
      );
    }
    seen.add(h.agentId);
  }
  if (history.length !== updates.length) {
    throw new Error(
      `applyRatingPeriod: history covers ${history.length} agents but ${updates.length} ` +
        `ratings were updated`,
    );
  }
}

