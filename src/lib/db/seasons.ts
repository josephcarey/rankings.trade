/**
 * Typed query helpers for the `seasons` and `season_standings` tables (Epic I).
 *
 * These are the persistence primitives the season seams and the admin season service compose
 * (src/lib/seasons/*). They are deliberately small and side-effect-explicit so the close
 * trigger's idempotency is easy to reason about:
 *
 *   - {@link getOpenSeason} is the single source of "the current season". At most one season
 *     has `closed_at IS NULL` (enforced by the partial unique index in migration 0012).
 *   - {@link isInUnrankedGap} is the resolver's gap check: a finalized round whose reset_date
 *     sits strictly between a closed season's closing reset and its `unranked_until` is in a
 *     warm-up gap and must be tagged unranked.
 *   - {@link closeSeason} is a single-winner conditional update (guarded by `closed_at IS
 *     NULL`), mirroring Epic G's `markFinalized`, so the season-close side effects run under
 *     one owner even on replay.
 *   - {@link upsertSeasonStanding} is a deterministic UPSERT, so a close replayed after a
 *     partial crash REPAIRS the archive rather than leaving stale rows.
 *
 * Reads against `rounds` (Epic G) and `ratings` (Epic H) are read-only — this module never
 * mutates another epic's tables.
 */

/** A season row as stored. */
export type Season = {
  id: number;
  label: string;
  cutoff_date: string;
  unranked_gap_days: number;
  opened_at: string;
  closed_at: string | null;
  closed_round_id: number | null;
  unranked_until: string | null;
  created_at: string;
};

/** Fields accepted when creating a season. */
export type CreateSeasonFields = {
  label: string;
  cutoff_date: string;
  unranked_gap_days: number;
};

/** Mutable fields of an open season. */
export type SeasonUpdate = {
  cutoff_date?: string;
  unranked_gap_days?: number;
};

/** One archived final-standing row. */
export type SeasonStandingInsert = {
  season_id: number;
  agent_id: number;
  final_rating: number;
  final_rd: number;
  final_volatility: number;
  final_rank: number;
  title: string | null;
  established: boolean;
  ranked_rounds: number;
};

/** An archived final-standing row as stored. */
export type SeasonStanding = {
  id: number;
  season_id: number;
  agent_id: number;
  final_rating: number;
  final_rd: number;
  final_volatility: number;
  final_rank: number;
  title: string | null;
  established: number;
  ranked_rounds: number;
  created_at: string;
};

const SEASON_COLUMNS = `id, label, cutoff_date, unranked_gap_days, opened_at, closed_at,
  closed_round_id, unranked_until, created_at`;

/** Rows modified by the last write (single-winner conditional updates rely on this). */
async function changes(
  result: Promise<{ meta?: { changes?: number } }>,
): Promise<number> {
  const resolved = await result;
  return resolved.meta?.changes ?? 0;
}

/** The one open season (`closed_at IS NULL`), or null when none is open. */
export async function getOpenSeason(db: D1Database): Promise<Season | null> {
  const row = await db
    .prepare(`SELECT ${SEASON_COLUMNS} FROM seasons WHERE closed_at IS NULL LIMIT 1`)
    .first<Season>();
  return row ?? null;
}

/** Look up a season by id. */
export async function getSeasonById(
  db: D1Database,
  id: number,
): Promise<Season | null> {
  const row = await db
    .prepare(`SELECT ${SEASON_COLUMNS} FROM seasons WHERE id = ?`)
    .bind(id)
    .first<Season>();
  return row ?? null;
}

/** Every season, newest first (for the admin list). */
export async function listSeasons(db: D1Database): Promise<Season[]> {
  const { results } = await db
    .prepare(`SELECT ${SEASON_COLUMNS} FROM seasons ORDER BY id DESC`)
    .all<Season>();
  return results ?? [];
}

/** Insert a new (open) season and return it. */
export async function insertSeason(
  db: D1Database,
  fields: CreateSeasonFields,
): Promise<Season> {
  const row = await db
    .prepare(
      `INSERT INTO seasons (label, cutoff_date, unranked_gap_days)
       VALUES (?, ?, ?)
       RETURNING ${SEASON_COLUMNS}`,
    )
    .bind(fields.label, fields.cutoff_date, fields.unranked_gap_days)
    .first<Season>();
  if (!row) throw new Error("insertSeason: row missing after insert");
  return row;
}

/**
 * Update an open season's cutoff and/or gap. Guarded by `closed_at IS NULL` so a closed
 * season is never retro-edited. Returns the updated row, or null if no open season matched.
 */
export async function updateOpenSeason(
  db: D1Database,
  id: number,
  fields: SeasonUpdate,
): Promise<Season | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (fields.cutoff_date !== undefined) {
    sets.push("cutoff_date = ?");
    binds.push(fields.cutoff_date);
  }
  if (fields.unranked_gap_days !== undefined) {
    sets.push("unranked_gap_days = ?");
    binds.push(fields.unranked_gap_days);
  }
  if (sets.length === 0) return getSeasonById(db, id);

  binds.push(id);
  await db
    .prepare(
      `UPDATE seasons SET ${sets.join(", ")} WHERE id = ? AND closed_at IS NULL`,
    )
    .bind(...binds)
    .run();
  const season = await getSeasonById(db, id);
  return season && season.closed_at === null ? season : null;
}

/**
 * True when `resetDate` falls inside a closed season's unranked warm-up gap — strictly after
 * that season's closing reset and strictly before its `unranked_until`. Only closed seasons
 * with a positive gap have a non-null `unranked_until`, so a zero-gap close never matches.
 */
export async function isInUnrankedGap(
  db: D1Database,
  resetDate: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present
       FROM seasons s
       JOIN rounds r ON r.id = s.closed_round_id
       WHERE s.closed_at IS NOT NULL
         AND s.unranked_until IS NOT NULL
         AND r.reset_date < ?
         AND s.unranked_until > ?
       LIMIT 1`,
    )
    .bind(resetDate, resetDate)
    .first<{ present: number }>();
  return row !== null;
}

/**
 * Close a season: single-winner conditional update guarded by `closed_at IS NULL`. Returns
 * true iff THIS caller flipped it, so the (idempotent) archive side effects are owned once.
 * `unrankedUntil` is the first ranked reset_date after the gap, or null when the gap is 0.
 */
export async function closeSeason(
  db: D1Database,
  args: { seasonId: number; closedRoundId: number; unrankedUntil: string | null },
): Promise<boolean> {
  const n = await changes(
    db
      .prepare(
        `UPDATE seasons
           SET closed_at = CURRENT_TIMESTAMP,
               closed_round_id = ?,
               unranked_until = ?
         WHERE id = ? AND closed_at IS NULL`,
      )
      .bind(args.closedRoundId, args.unrankedUntil, args.seasonId)
      .run(),
  );
  return n === 1;
}

const UPSERT_STANDING_SQL = `
  INSERT INTO season_standings
    (season_id, agent_id, final_rating, final_rd, final_volatility, final_rank,
     title, established, ranked_rounds)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (season_id, agent_id) DO UPDATE SET
    final_rating = excluded.final_rating,
    final_rd = excluded.final_rd,
    final_volatility = excluded.final_volatility,
    final_rank = excluded.final_rank,
    title = excluded.title,
    established = excluded.established,
    ranked_rounds = excluded.ranked_rounds`;

/**
 * Archive every agent's final standing for a season as a deterministic UPSERT batch, so a
 * replayed close repairs rather than ignores. A no-op when there are no rows.
 */
export async function upsertSeasonStandings(
  db: D1Database,
  rows: readonly SeasonStandingInsert[],
): Promise<void> {
  if (rows.length === 0) return;

  const stmt = db.prepare(UPSERT_STANDING_SQL);
  const statements = rows.map((r) =>
    stmt.bind(
      r.season_id,
      r.agent_id,
      r.final_rating,
      r.final_rd,
      r.final_volatility,
      r.final_rank,
      r.title,
      r.established ? 1 : 0,
      r.ranked_rounds,
    ),
  );
  await db.batch(statements);
}

/** A season's archived standings, best rank first (for display/tests). */
export async function listSeasonStandings(
  db: D1Database,
  seasonId: number,
): Promise<SeasonStanding[]> {
  const { results } = await db
    .prepare(
      `SELECT id, season_id, agent_id, final_rating, final_rd, final_volatility,
              final_rank, title, established, ranked_rounds, created_at
       FROM season_standings
       WHERE season_id = ?
       ORDER BY final_rank ASC, agent_id ASC`,
    )
    .bind(seasonId)
    .all<SeasonStanding>();
  return results ?? [];
}

/**
 * Ranked-round participation counts per agent for a season: how many ranked Universe rounds
 * each registered agent actually participated in. Drives the established-rating floor's
 * "minimum ranked rounds" check without materialising another epic's state.
 */
export async function countRankedRoundsByAgent(
  db: D1Database,
  seasonId: number,
): Promise<Map<number, number>> {
  const { results } = await db
    .prepare(
      `SELECT rs.agent_id AS agent_id, COUNT(*) AS n
       FROM round_standings rs
       JOIN rounds r ON r.id = rs.round_id
       WHERE r.season_id = ?
         AND r.is_ranked = 1
         AND rs.league_id IS NULL
         AND rs.participated = 1
         AND rs.agent_id IS NOT NULL
       GROUP BY rs.agent_id`,
    )
    .bind(seasonId)
    .all<{ agent_id: number; n: number }>();
  return new Map((results ?? []).map((row) => [row.agent_id, row.n]));
}

/** One agent's archived placement in a past season, joined with the season label. */
export type AgentSeasonHistoryRow = {
  season_id: number;
  label: string;
  closed_at: string | null;
  final_rating: number;
  final_rd: number;
  final_rank: number;
  title: string | null;
  established: number;
  ranked_rounds: number;
};

/**
 * One agent's archived season placements (Epic M read API), newest season first. Sourced from
 * `season_standings` — the retained per-season history written at each season's close (DEC-I2),
 * never the live `ratings` table — so it never mixes the open season's in-progress state in.
 */
export async function listAgentSeasonHistory(
  db: D1Database,
  agentId: number,
): Promise<AgentSeasonHistoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ss.season_id AS season_id, s.label AS label, s.closed_at AS closed_at,
              ss.final_rating AS final_rating, ss.final_rd AS final_rd,
              ss.final_rank AS final_rank, ss.title AS title,
              ss.established AS established, ss.ranked_rounds AS ranked_rounds
       FROM season_standings ss
       JOIN seasons s ON s.id = ss.season_id
       WHERE ss.agent_id = ?
       ORDER BY ss.season_id DESC`,
    )
    .bind(agentId)
    .all<AgentSeasonHistoryRow>();
  return results ?? [];
}
