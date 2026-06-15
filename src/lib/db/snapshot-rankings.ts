/**
 * Live (pre-finalize) snapshot ranking views.
 *
 * Every competitive/credit view in the app is finalize-gated (`finalized_at IS
 * NOT NULL`), so the live `snapshots` a cron captures every 15 minutes are
 * invisible in the UI until the first round finalizes. These helpers read the
 * `snapshots` table DIRECTLY so the current cycle's standings can be shown
 * before any finalize.
 *
 * "Current cycle" is the most-recent `reset_date` present in `snapshots`
 * (`MAX(reset_date)`) — snapshots carry no season/round link, so the latest
 * reset is the open cycle. For each agent the LATEST `observed_at` bucket in
 * that cycle is its live position. Snapshots join to `agents` by **symbol**
 * (the table has no `agent_id` column); the join is a LEFT JOIN so scraped but
 * unclaimed agents still appear.
 */

/** One agent's live position in the current snapshot cycle. */
export interface SnapshotRankingRow {
  /** Ordinal 1-based position by descending credits (ties broken by symbol). */
  readonly rank: number;
  readonly symbol: string;
  /** Local agents.id, or null when the symbol has no agents row (unclaimed). */
  readonly agent_id: number | null;
  readonly display_name: string | null;
  readonly credits: number | null;
  readonly credit_rank: number | null;
  readonly ship_count: number | null;
}

/** A snapshot credit series aligned to a shared, ascending `observed_at` axis. */
export interface SnapshotSeries {
  /** Distinct capture times for the cycle, oldest first (the x-axis). */
  readonly observedAts: string[];
  /** symbol → credits aligned to `observedAts` (null where not observed). */
  readonly bySymbol: Map<string, (null | number)[]>;
}

/**
 * Maximum number of x-axis columns shipped in the all-agent series matrix.
 *
 * A cycle can hold hundreds of `observed_at` buckets (many from a legacy
 * import); shipping every agent at every bucket would be a multi-hundred-KB
 * payload. We downsample the axis to this many evenly-spaced columns — enough to
 * show each line's shape while keeping the page within its cache budget. Tune
 * here: lower = smaller payload + coarser lines, higher = the reverse.
 */
const SERIES_MATRIX_MAX_COLUMNS = 48;

/**
 * Pick at most `maxColumns` evenly-spaced indices from `[0, length)`, ALWAYS
 * keeping the first and last so a downsampled series spans the full cycle.
 * Deterministic and pure. Returns every index when `length <= maxColumns`.
 */
export function pickDownsampledIndices(
  length: number,
  maxColumns: number,
): number[] {
  if (length <= 0 || maxColumns <= 0) return [];
  if (length <= maxColumns) return Array.from({ length }, (_, i) => i);
  if (maxColumns === 1) return [0];

  const indices: number[] = [];
  for (let i = 0; i < maxColumns; i++) {
    indices.push(Math.round((i / (maxColumns - 1)) * (length - 1)));
  }
  // Dedup defensively in case rounding maps two slots to the same index.
  return [...new Set(indices)];
}

/**
 * The current snapshot cycle's `reset_date` (`MAX(reset_date)`), or null when no
 * snapshots exist yet.
 */
export async function getCurrentSnapshotResetDate(
  db: D1Database,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT MAX(reset_date) AS rd FROM snapshots")
    .first<{ rd: string | null }>();
  return row?.rd ?? null;
}

interface RankingQueryRow {
  symbol: string;
  agent_id: number | null;
  display_name: string | null;
  credits: number | null;
  credit_rank: number | null;
  ship_count: number | null;
}

/**
 * The current cycle's full ranking from the latest snapshot bucket per agent,
 * ordered by credits descending (ties broken by symbol). Empty when there are no
 * snapshots yet.
 *
 * Each agent contributes exactly one row — its MAX(`observed_at`) capture in the
 * current `reset_date` — so re-observations within the cycle never double-count.
 */
export async function listCurrentUniverseSnapshotRanking(
  db: D1Database,
): Promise<SnapshotRankingRow[]> {
  const { results } = await db
    .prepare(
      `WITH cur AS (SELECT MAX(reset_date) AS rd FROM snapshots),
            latest AS (
              SELECT s.agent_symbol AS agent_symbol,
                     MAX(s.observed_at) AS observed_at
              FROM snapshots s
              JOIN cur ON s.reset_date = cur.rd
              GROUP BY s.agent_symbol
            )
       SELECT s.agent_symbol AS symbol,
              s.credits       AS credits,
              s.credit_rank   AS credit_rank,
              s.ship_count    AS ship_count,
              a.id            AS agent_id,
              a.display_name  AS display_name
       FROM snapshots s
       JOIN cur ON s.reset_date = cur.rd
       JOIN latest l
         ON l.agent_symbol = s.agent_symbol
        AND l.observed_at = s.observed_at
       LEFT JOIN agents a ON a.symbol = s.agent_symbol
       ORDER BY s.credits DESC, s.agent_symbol ASC`,
    )
    .all<RankingQueryRow>();

  return (results ?? []).map((row, index) => ({
    rank: index + 1,
    symbol: row.symbol,
    agent_id: row.agent_id ?? null,
    display_name: row.display_name ?? null,
    credits: row.credits ?? null,
    credit_rank: row.credit_rank ?? null,
    ship_count: row.ship_count ?? null,
  }));
}

interface SeriesQueryRow {
  observed_at: string;
  agent_symbol: string;
  credits: number | null;
}

/**
 * Per-symbol credit series across the snapshot history of one cycle, aligned to
 * a shared ascending `observed_at` axis (a missing observation is a null GAP,
 * never a zero). Empty input — no symbols or no `resetDate` — yields an empty
 * series, ready to feed {@link buildLineChart}.
 */
export async function listCurrentSnapshotSeries(
  db: D1Database,
  resetDate: string | null,
  symbols: readonly string[],
): Promise<SnapshotSeries> {
  if (resetDate === null || symbols.length === 0) {
    return { observedAts: [], bySymbol: new Map() };
  }

  const placeholders = symbols.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT observed_at AS observed_at,
              agent_symbol AS agent_symbol,
              credits AS credits
       FROM snapshots
       WHERE reset_date = ? AND agent_symbol IN (${placeholders})
       ORDER BY observed_at ASC`,
    )
    .bind(resetDate, ...symbols)
    .all<SeriesQueryRow>();
  const rows = results ?? [];

  const observedAts = [...new Set(rows.map((r) => r.observed_at))].toSorted();
  const indexByTime = new Map(observedAts.map((t, i) => [t, i]));
  const bySymbol = new Map<string, (null | number)[]>(
    symbols.map((s) => [
      s,
      Array.from({ length: observedAts.length }, () => null as null | number),
    ]),
  );

  for (const row of rows) {
    const series = bySymbol.get(row.agent_symbol);
    const at = indexByTime.get(row.observed_at);
    if (series && at !== undefined) series[at] = row.credits;
  }

  return { observedAts, bySymbol };
}

/**
 * Credit series for ALL agents in one cycle, aligned to a DOWNSAMPLED ascending
 * `observed_at` axis of at most {@link SERIES_MATRIX_MAX_COLUMNS} columns. This
 * is the matrix shipped to the live page so the client can toggle any agent's
 * line and recompute the chart (incl. y-axis rescale) via `buildLineChart`
 * without a per-agent round-trip.
 *
 * Cost is bounded: one cheap `DISTINCT observed_at` scan to learn the axis, then
 * a single `WHERE reset_date = ? AND observed_at IN (…)` fetch served by the
 * existing `idx_snapshots_reset_time (reset_date, observed_at)` index — no
 * schema change. A missing observation is a null GAP, never a zero.
 */
export async function listCurrentSnapshotSeriesMatrix(
  db: D1Database,
  resetDate: string | null,
  maxColumns: number = SERIES_MATRIX_MAX_COLUMNS,
): Promise<SnapshotSeries> {
  if (resetDate === null) return { observedAts: [], bySymbol: new Map() };

  const { results: timeRows } = await db
    .prepare(
      `SELECT DISTINCT observed_at AS observed_at
       FROM snapshots
       WHERE reset_date = ?
       ORDER BY observed_at ASC`,
    )
    .bind(resetDate)
    .all<{ observed_at: string }>();
  const allTimes = (timeRows ?? []).map((r) => r.observed_at);
  if (allTimes.length === 0) return { observedAts: [], bySymbol: new Map() };

  const observedAts = pickDownsampledIndices(allTimes.length, maxColumns).map(
    (i) => allTimes[i]!,
  );

  const placeholders = observedAts.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT observed_at AS observed_at,
              agent_symbol AS agent_symbol,
              credits AS credits
       FROM snapshots
       WHERE reset_date = ? AND observed_at IN (${placeholders})
       ORDER BY observed_at ASC`,
    )
    .bind(resetDate, ...observedAts)
    .all<SeriesQueryRow>();
  const rows = results ?? [];

  const indexByTime = new Map(observedAts.map((t, i) => [t, i]));
  const bySymbol = new Map<string, (null | number)[]>();
  for (const row of rows) {
    let series = bySymbol.get(row.agent_symbol);
    if (!series) {
      series = Array.from(
        { length: observedAts.length },
        () => null as null | number,
      );
      bySymbol.set(row.agent_symbol, series);
    }
    const at = indexByTime.get(row.observed_at);
    if (at !== undefined) series[at] = row.credits;
  }

  return { observedAts, bySymbol };
}
