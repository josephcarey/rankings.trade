/**
 * Typed query helpers for the `open_season_standings` cache (migration 0018, audit §8.1).
 *
 * This is the materialized form of `computeSeasonStandings` for the OPEN season (DEC-I2): the
 * rating trigger writes the whole recomputed field here on each ranked-round finalize, and the
 * public/UI read paths SELECT from here instead of recomputing per request.
 *
 * WRITE: {@link upsertOpenSeasonStandings} is a deterministic UPSERT on the natural key
 * (season_id, agent_id) in a SINGLE atomic `db.batch()`, so a reader never observes a
 * half-updated snapshot. It mirrors `applyRatingPeriod`'s batch-ceiling guard: the rating apply
 * already caps a season at ~{@link D1_MAX_BATCH} rated agents, so the full field always fits one
 * batch — if it ever does not, this throws loudly rather than splitting a snapshot across
 * non-atomic batches.
 *
 * READ: all selects are scoped by `season_id`; closed-season rows are never read because every
 * caller passes the OPEN season id.
 */

import type { SeasonStandingInsert } from "./seasons";

import { D1_MAX_BATCH } from "./constants";

/** One materialized leaderboard row joined with its agent symbol (the public page shape). */
export type OpenStandingPageRow = {
  agent_id: number;
  agent_symbol: string;
  final_rating: number;
  final_rd: number;
  final_volatility: number;
  final_rank: number;
  title: string | null;
  established: boolean;
  ranked_rounds: number;
};

const UPSERT_SQL = `
  INSERT INTO open_season_standings
    (season_id, agent_id, final_rating, final_rd, final_volatility, final_rank,
     title, established, ranked_rounds, materialized_round_id, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT (season_id, agent_id) DO UPDATE SET
    final_rating = excluded.final_rating,
    final_rd = excluded.final_rd,
    final_volatility = excluded.final_volatility,
    final_rank = excluded.final_rank,
    title = excluded.title,
    established = excluded.established,
    ranked_rounds = excluded.ranked_rounds,
    materialized_round_id = excluded.materialized_round_id,
    updated_at = CURRENT_TIMESTAMP`;

/** Columns selected for a {@link SeasonStandingInsert}-shaped row. */
const STANDING_COLUMNS = `season_id, agent_id, final_rating, final_rd, final_volatility,
  final_rank, title, established, ranked_rounds`;

/** Canonical leaderboard order: rating desc, agent_id asc — identical to computeSeasonStandings. */
const ORDER = `ORDER BY final_rating DESC, agent_id ASC`;

/** A stored cache row as returned by SQLite (established is 0/1). */
type StoredRow = Omit<SeasonStandingInsert, "established"> & { established: number };

function toStandingInsert(row: StoredRow): SeasonStandingInsert {
  return { ...row, established: row.established === 1 };
}

/**
 * Materialize the OPEN season's standings as a single atomic UPSERT batch. A no-op when there
 * are no rows. Throws if the field exceeds {@link D1_MAX_BATCH} (it cannot, given the rating
 * apply's own ceiling) rather than splitting the snapshot across non-atomic batches.
 */
export async function upsertOpenSeasonStandings(
  db: D1Database,
  seasonId: number,
  rows: readonly SeasonStandingInsert[],
  roundId: number | null,
): Promise<void> {
  if (rows.length === 0) return;
  if (rows.length > D1_MAX_BATCH) {
    throw new Error(
      `upsertOpenSeasonStandings: ${rows.length} rows exceed the atomic batch ceiling ` +
        `(${D1_MAX_BATCH}); a snapshot must not be split across batches`,
    );
  }

  const stmt = db.prepare(UPSERT_SQL);
  const statements = rows.map((r) =>
    stmt.bind(
      seasonId,
      r.agent_id,
      r.final_rating,
      r.final_rd,
      r.final_volatility,
      r.final_rank,
      r.title,
      r.established ? 1 : 0,
      r.ranked_rounds,
      roundId,
    ),
  );
  await db.batch(statements);
}

/** Every materialized row for a season, in canonical leaderboard order. */
export async function selectOpenSeasonStandings(
  db: D1Database,
  seasonId: number,
): Promise<SeasonStandingInsert[]> {
  const { results } = await db
    .prepare(
      `SELECT ${STANDING_COLUMNS} FROM open_season_standings WHERE season_id = ? ${ORDER}`,
    )
    .bind(seasonId)
    .all<StoredRow>();
  return (results ?? []).map((r) => toStandingInsert(r));
}

/** One agent's materialized standing in a season, or null if not present. */
export async function selectOpenSeasonStanding(
  db: D1Database,
  seasonId: number,
  agentId: number,
): Promise<SeasonStandingInsert | null> {
  const row = await db
    .prepare(
      `SELECT ${STANDING_COLUMNS} FROM open_season_standings
       WHERE season_id = ? AND agent_id = ?`,
    )
    .bind(seasonId, agentId)
    .first<StoredRow>();
  return row ? toStandingInsert(row) : null;
}

/** True when the season has any materialized rows (the cold-cache probe). */
export async function openSeasonStandingsExist(
  db: D1Database,
  seasonId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM open_season_standings WHERE season_id = ? LIMIT 1`,
    )
    .bind(seasonId)
    .first<{ present: number }>();
  return row !== null;
}

/** How many agents are materialized for a season (the page `total`). */
export async function countOpenSeasonStandings(
  db: D1Database,
  seasonId: number,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM open_season_standings WHERE season_id = ?`)
    .bind(seasonId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * One page of the materialized leaderboard, joined with agent symbols, in canonical order.
 * Pagination is pushed into SQL (`LIMIT`/`OFFSET`); pair with {@link countOpenSeasonStandings}
 * for the total.
 */
export async function selectOpenSeasonStandingsPage(
  db: D1Database,
  seasonId: number,
  limit: number,
  offset: number,
): Promise<OpenStandingPageRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.agent_id AS agent_id, a.symbol AS agent_symbol,
              s.final_rating AS final_rating, s.final_rd AS final_rd,
              s.final_volatility AS final_volatility, s.final_rank AS final_rank,
              s.title AS title, s.established AS established,
              s.ranked_rounds AS ranked_rounds
       FROM open_season_standings s
       JOIN agents a ON a.id = s.agent_id
       WHERE s.season_id = ?
       ORDER BY s.final_rating DESC, s.agent_id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(seasonId, limit, offset)
    .all<Omit<OpenStandingPageRow, "established"> & { established: number }>();
  return (results ?? []).map((r) => ({ ...r, established: r.established === 1 }));
}
