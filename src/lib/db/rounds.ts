/**
 * Typed query helpers for the `rounds` and `round_standings` tables (Epic G).
 *
 * These are the persistence primitives the finalization orchestrator
 * (`src/lib/rounds/finalize.ts`) composes. They are deliberately small and
 * side-effect-explicit so the orchestrator's idempotency and immutable-history
 * guarantees are easy to reason about:
 *
 *   - {@link beginFinalization} writes the immutable INPUTS of a finalization
 *     (the final observation, the freeze point, the season tag) exactly once,
 *     guarded by `membership_frozen_at IS NULL`. Retries re-read the persisted
 *     inputs rather than recomputing them, so standings are byte-stable.
 *   - {@link insertStandings} is INSERT OR IGNORE against the partial unique
 *     indexes, so re-running finalization never duplicates a standing.
 *   - {@link markFinalized}/{@link markRatingsApplied}/{@link markSeasonProcessed}
 *     are single-winner conditional updates returning whether THIS caller won,
 *     so the (idempotent) downstream Epic H/I triggers fire under a single owner.
 *
 * Reads against `snapshots` (Epic D) and `league_members` (Epic E) are
 * read-only — this module never mutates another epic's tables.
 */

import { D1_MAX_BATCH } from "./snapshots";

/** A round row as stored. `is_ranked`/booleans are SQLite integers (0|1). */
export type Round = {
  id: number;
  reset_date: string;
  started_at: string | null;
  final_observed_at: string | null;
  membership_frozen_at: string | null;
  finalized_at: string | null;
  season_id: number | null;
  is_ranked: number;
  ratings_applied_at: string | null;
  season_processed_at: string | null;
  created_at: string;
};

/** A frozen standing row. `league_id` NULL is the global Universe scope. */
export type RoundStanding = {
  id: number;
  round_id: number;
  league_id: number | null;
  agent_symbol: string;
  agent_id: number | null;
  final_credits: number | null;
  final_rank: number;
  participated: number;
  created_at: string;
};

/** Fields for one {@link insertStandings} row. */
export type StandingInsert = {
  round_id: number;
  league_id: number | null;
  agent_symbol: string;
  agent_id: number | null;
  final_credits: number | null;
  final_rank: number;
  participated: number;
};

/** Immutable inputs persisted by {@link beginFinalization}. */
export type FinalizationInputs = {
  finalObservedAt: string;
  startedAt: string | null;
  seasonId: number | null;
  isRanked: boolean;
};

/** One agent's snapshot row at a single observation, used to build standings. */
export type FinalSnapshotRow = {
  agent_symbol: string;
  agent_id: number | null;
  credits: number | null;
  credit_rank: number | null;
};

/** A league member resolved as of a freeze point, used to build league standings. */
export type FrozenMember = {
  league_id: number;
  agent_id: number;
  agent_symbol: string;
};

const ROUND_COLUMNS = `id, reset_date, started_at, final_observed_at, membership_frozen_at,
  finalized_at, season_id, is_ranked, ratings_applied_at, season_processed_at, created_at`;

/** Rows modified by the last write (single-winner conditional updates rely on this). */
async function changes(
  result: Promise<{ meta?: { changes?: number } }>,
): Promise<number> {
  const resolved = await result;
  return resolved.meta?.changes ?? 0;
}

/** Look up a round by its SpaceTraders reset_date key. */
export async function getRoundByResetDate(
  db: D1Database,
  resetDate: string,
): Promise<Round | null> {
  const row = await db
    .prepare(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE reset_date = ?`)
    .bind(resetDate)
    .first<Round>();
  return row ?? null;
}

/** Look up a round by id. */
export async function getRoundById(
  db: D1Database,
  id: number,
): Promise<Round | null> {
  const row = await db
    .prepare(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE id = ?`)
    .bind(id)
    .first<Round>();
  return row ?? null;
}

/**
 * Find or create the (unranked, untagged) round row for a reset_date.
 *
 * Concurrency-safe: the insert is `INSERT OR IGNORE` on the unique `reset_date`,
 * so two racing finalizers converge on one row.
 */
export async function getOrCreateRound(
  db: D1Database,
  resetDate: string,
): Promise<Round> {
  const existing = await getRoundByResetDate(db, resetDate);
  if (existing) return existing;

  await db
    .prepare("INSERT OR IGNORE INTO rounds (reset_date) VALUES (?)")
    .bind(resetDate)
    .run();

  const created = await getRoundByResetDate(db, resetDate);
  if (!created) throw new Error("getOrCreateRound: round missing after insert");
  return created;
}

/**
 * Persist the immutable finalization inputs and stamp the membership freeze point,
 * exactly once. Guarded by `membership_frozen_at IS NULL` so only the first caller
 * writes these — later callers (retries, races) re-read the winner's values.
 *
 * Returns the round as it stands after the attempt (carrying the persisted inputs,
 * whether written by this caller or a prior winner).
 */
export async function beginFinalization(
  db: D1Database,
  roundId: number,
  inputs: FinalizationInputs,
): Promise<Round> {
  await db
    .prepare(
      `UPDATE rounds
         SET membership_frozen_at = CURRENT_TIMESTAMP,
             final_observed_at = ?,
             started_at = ?,
             season_id = ?,
             is_ranked = ?
       WHERE id = ? AND membership_frozen_at IS NULL`,
    )
    .bind(
      inputs.finalObservedAt,
      inputs.startedAt,
      inputs.seasonId,
      inputs.isRanked ? 1 : 0,
      roundId,
    )
    .run();

  const round = await getRoundById(db, roundId);
  if (!round) throw new Error("beginFinalization: round missing after claim");
  return round;
}

/**
 * Set `finalized_at` if not already set. Returns true iff THIS caller flipped it,
 * so the downstream Epic H/I triggers fire under a single owner on the common path.
 */
export async function markFinalized(
  db: D1Database,
  roundId: number,
): Promise<boolean> {
  const n = await changes(
    db
      .prepare(
        "UPDATE rounds SET finalized_at = CURRENT_TIMESTAMP WHERE id = ? AND finalized_at IS NULL",
      )
      .bind(roundId)
      .run(),
  );
  return n === 1;
}

/** Single-winner marker for "Epic H ratings step has been processed for this round". */
export async function markRatingsApplied(
  db: D1Database,
  roundId: number,
): Promise<boolean> {
  const n = await changes(
    db
      .prepare(
        "UPDATE rounds SET ratings_applied_at = CURRENT_TIMESTAMP WHERE id = ? AND ratings_applied_at IS NULL",
      )
      .bind(roundId)
      .run(),
  );
  return n === 1;
}

/** Single-winner marker for "Epic I season-close step has been evaluated for this round". */
export async function markSeasonProcessed(
  db: D1Database,
  roundId: number,
): Promise<boolean> {
  const n = await changes(
    db
      .prepare(
        "UPDATE rounds SET season_processed_at = CURRENT_TIMESTAMP WHERE id = ? AND season_processed_at IS NULL",
      )
      .bind(roundId)
      .run(),
  );
  return n === 1;
}

const INSERT_STANDING_SQL = `INSERT OR IGNORE INTO round_standings
    (round_id, league_id, agent_symbol, agent_id, final_credits, final_rank, participated)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

/**
 * Insert standings, chunked to D1's batch limit. `INSERT OR IGNORE` against the
 * partial unique indexes makes a re-run a no-op on rows already written, which is
 * the backstop for crash-in-the-middle idempotency.
 */
export async function insertStandings(
  db: D1Database,
  rows: StandingInsert[],
): Promise<void> {
  if (rows.length === 0) return;

  const stmt = db.prepare(INSERT_STANDING_SQL);
  const statements = rows.map((r) =>
    stmt.bind(
      r.round_id,
      r.league_id,
      r.agent_symbol,
      r.agent_id,
      r.final_credits,
      r.final_rank,
      r.participated,
    ),
  );

  for (let i = 0; i < statements.length; i += D1_MAX_BATCH) {
    await db.batch(statements.slice(i, i + D1_MAX_BATCH));
  }
}

/** List a round's standings for a scope: a league id, or `null` for Universe. */
export async function listStandings(
  db: D1Database,
  roundId: number,
  leagueId: number | null,
): Promise<RoundStanding[]> {
  const scope =
    leagueId === null ? "league_id IS NULL" : "league_id = ?";
  const binds: unknown[] = leagueId === null ? [roundId] : [roundId, leagueId];
  const { results } = await db
    .prepare(
      `SELECT id, round_id, league_id, agent_symbol, agent_id, final_credits,
              final_rank, participated, created_at
       FROM round_standings
       WHERE round_id = ? AND ${scope}
       ORDER BY final_rank ASC, agent_symbol ASC`,
    )
    .bind(...binds)
    .all<RoundStanding>();
  return results ?? [];
}

/**
 * The most recent finalized round that has standings for a league (Epic M read API).
 * "A league's standings" are the latest frozen round_standings for that league; this
 * resolves which round those are. Returns null when the league has no finalized
 * standings yet (e.g. a brand-new league before its first round closed).
 */
export async function getLatestFinalizedLeagueRound(
  db: D1Database,
  leagueId: number,
): Promise<Round | null> {
  const row = await db
    .prepare(
      `SELECT ${ROUND_COLUMNS}
       FROM rounds r
       WHERE r.finalized_at IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM round_standings rs
           WHERE rs.round_id = r.id AND rs.league_id = ?
         )
       ORDER BY r.reset_date DESC, r.id DESC
       LIMIT 1`,
    )
    .bind(leagueId)
    .first<Round>();
  return row ?? null;
}

/**
 * Epic H seam: the Universe standings that should enter the Glicko rating period
 * for a round — registered, participating agents with a credit value. Outcomes are
 * derived from `final_credits` (equal credits = draw); non-participants and
 * unregistered agents are excluded here and handled by H's RD-inflation path.
 */
export async function listRateableUniverseStandings(
  db: D1Database,
  roundId: number,
): Promise<RoundStanding[]> {
  const { results } = await db
    .prepare(
      `SELECT id, round_id, league_id, agent_symbol, agent_id, final_credits,
              final_rank, participated, created_at
       FROM round_standings
       WHERE round_id = ? AND league_id IS NULL
         AND participated = 1 AND final_credits IS NOT NULL AND agent_id IS NOT NULL
       ORDER BY final_rank ASC, agent_symbol ASC`,
    )
    .bind(roundId)
    .all<RoundStanding>();
  return results ?? [];
}

/**
 * Reset-detection query: reset_dates present in `snapshots` that are NOT the live
 * reset and do NOT yet have a finalized round. Each is a completed round to finalize.
 */
export async function listEndedResetDates(
  db: D1Database,
  currentResetDate: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT s.reset_date AS reset_date
       FROM snapshots s
       WHERE s.reset_date <> ?
         AND NOT EXISTS (
           SELECT 1 FROM rounds r
           WHERE r.reset_date = s.reset_date AND r.finalized_at IS NOT NULL
         )
       ORDER BY s.reset_date ASC`,
    )
    .bind(currentResetDate)
    .all<{ reset_date: string }>();
  return (results ?? []).map((r) => r.reset_date);
}

/**
 * Finalized rounds whose downstream Epic H/I work has not completed yet. Re-processing
 * these recovers any trigger lost to a crash between finalization and the trigger call.
 */
export async function listRoundsPendingTriggers(
  db: D1Database,
): Promise<Round[]> {
  const { results } = await db
    .prepare(
      `SELECT ${ROUND_COLUMNS} FROM rounds
       WHERE finalized_at IS NOT NULL
         AND ((is_ranked = 1 AND ratings_applied_at IS NULL)
              OR season_processed_at IS NULL)
       ORDER BY id ASC`,
    )
    .all<Round>();
  return results ?? [];
}

/** The latest observation timestamp captured for a reset_date, or null if none. */
export async function getFinalObservedAt(
  db: D1Database,
  resetDate: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT MAX(observed_at) AS observed_at FROM snapshots WHERE reset_date = ?",
    )
    .bind(resetDate)
    .first<{ observed_at: string | null }>();
  return row?.observed_at ?? null;
}

/** The earliest observation timestamp captured for a reset_date, or null if none. */
export async function getFirstObservedAt(
  db: D1Database,
  resetDate: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT MIN(observed_at) AS observed_at FROM snapshots WHERE reset_date = ?",
    )
    .bind(resetDate)
    .first<{ observed_at: string | null }>();
  return row?.observed_at ?? null;
}

/**
 * Every agent's snapshot row at one observation of a round — the final standings
 * source. Left-joins `agents` so a registered participant carries its `agent_id`
 * (Epic H rates registered agents only); scraped-but-unregistered agents get NULL.
 */
export async function getSnapshotRowsAt(
  db: D1Database,
  resetDate: string,
  observedAt: string,
): Promise<FinalSnapshotRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.agent_symbol AS agent_symbol, a.id AS agent_id,
              s.credits AS credits, s.credit_rank AS credit_rank
       FROM snapshots s
       LEFT JOIN agents a ON a.symbol = s.agent_symbol
       WHERE s.reset_date = ? AND s.observed_at = ?
       ORDER BY s.credit_rank ASC, s.agent_symbol ASC`,
    )
    .bind(resetDate, observedAt)
    .all<FinalSnapshotRow>();
  return results ?? [];
}

/**
 * League members active as of a freeze point, across every league. Reconstructs the
 * roster at `frozenAt` (`joined_at <= frozen AND (left_at IS NULL OR left_at > frozen)`)
 * so a later join/leave can never rewrite an archived round's membership.
 */
export async function getMembersFrozenAt(
  db: D1Database,
  frozenAt: string,
): Promise<FrozenMember[]> {
  const { results } = await db
    .prepare(
      `SELECT m.league_id AS league_id, a.id AS agent_id, a.symbol AS agent_symbol
       FROM league_members m
       JOIN agents a ON a.id = m.agent_id
       WHERE m.joined_at <= ? AND (m.left_at IS NULL OR m.left_at > ?)
       ORDER BY m.league_id ASC, m.joined_at ASC, m.id ASC`,
    )
    .bind(frozenAt, frozenAt)
    .all<FrozenMember>();
  return results ?? [];
}
