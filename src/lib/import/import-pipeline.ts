/**
 * The one-time legacy import orchestrator (Epic K).
 *
 * Drives the full pre-launch backfill by COMPOSING the existing epics rather than
 * re-implementing any of them:
 *
 *   1. {@link transformSnapshots} maps the legacy export onto the `snapshots` contract.
 *   2. A read-only PREFLIGHT validates the run is safe and idempotent (no foreign open
 *      season, the rating field fits one D1 batch, the launch reset is in the future, and a
 *      pre-existing Season 0 matches this run exactly).
 *   3. Distinct legacy agents are registered as unclaimed `agents` rows (so the genesis
 *      rating replay can attach `agent_id`).
 *   4. {@link writeSnapshots} upserts the snapshots (idempotent on the natural key).
 *   5. An archived "Season 0" is opened with `cutoff_date` = the LAST legacy reset_date.
 *   6. {@link finalizePendingRounds} reconstructs rounds from the snapshots' reset_dates IN
 *      CHRONOLOGICAL ORDER, freezes each round's final standing (= its last observation),
 *      replays Epic H's Glicko-2 ratings FROM GENESIS over those rounds, and — because the
 *      final round's reset_date equals the cutoff — closes & archives Season 0 (DEC-6/I2).
 *      The live season is therefore opened EMPTY at launch (a separate, admin/runbook step).
 *
 * IDEMPOTENT & DETERMINISTIC: every write is on an idempotent key (snapshots upsert, agents
 * INSERT OR IGNORE, rounds/ratings/season markers, season_standings UPSERT), agents are
 * registered in sorted-symbol order for stable ids, and a re-run (including after a partial
 * crash) repairs rather than duplicates. "Deterministic" is SEMANTIC: row values are a
 * function of the input; server-clock timestamps and autoincrement ids are excluded.
 *
 * SCOPE: this module performs NO production cutover on its own — it is invoked by the dry-run
 * tests against fixtures and, later, by the human-gated cutover script (scripts/import-legacy.ts).
 */

import type { AgentSnapshotRow } from "../db/snapshots-types";
import type { FinalizationSeams } from "../rounds/seams";
import type {
  ImportOptions,
  ImportSummary,
  IntegrityFinding,
  LegacySnapshotRow,
} from "./legacy-types";

import { isValidSymbol } from "../db/agents";
import { listSeasonStandings } from "../db/seasons";
import { D1_MAX_BATCH, writeSnapshots } from "../db/snapshots";
import { glickoRatingTrigger } from "../ratings/trigger";
import { finalizePendingRounds } from "../rounds/finalize";
import { defaultFinalizationSeams } from "../rounds/seams";
import { seasonCloseEvaluator, seasonCloseTrigger } from "../seasons/close";
import { seasonResolver } from "../seasons/resolver";
import { transformSnapshots } from "./transform";

const DEFAULT_SEASON_LABEL = "Season 0";
const DEFAULT_INCOMPLETE_THRESHOLD = 0.5;

/**
 * Production finalization seams: Epic G's inert defaults with Epic H's real Glicko-2 rating
 * trigger and Epic I's real season resolver/close seams — the SAME composition production
 * uses (src/lib/scrape/scheduled.ts). Reusing them guarantees the backfill behaves byte-for-
 * byte like a live finalization; the import adds no rating or season logic of its own.
 */
const importSeams: FinalizationSeams = {
  ...defaultFinalizationSeams,
  ratingTrigger: glickoRatingTrigger,
  seasonCloseEvaluator,
  seasonCloseTrigger,
  seasonResolver,
};

/** A row of the `seasons` table (only the columns the import inspects). */
interface SeasonRow {
  id: number;
  label: string;
  cutoff_date: string;
  unranked_gap_days: number;
  closed_at: string | null;
  closed_round_id: number | null;
}

/** Distinct reset_dates in chronological order; lexicographic == chronological for ISO dates. */
function distinctResetDates(rows: readonly AgentSnapshotRow[]): string[] {
  return [...new Set(rows.map((r) => r.reset_date))].toSorted();
}

/**
 * Per-round data-quality analysis from the transformed rows (pure). For each reset_date it
 * compares the agent count at the round's PEAK observation bucket against its FINAL bucket —
 * a final bucket that shrank below `threshold * peak` is flagged as an incomplete final
 * snapshot (its missing agents will be excluded from that round's frozen standing, exactly
 * as a live finalization would treat them).
 */
export function analyzeIntegrity(
  rows: readonly AgentSnapshotRow[],
  threshold: number,
): IntegrityFinding[] {
  const byRound = new Map<string, Map<string, Set<string>>>();
  for (const row of rows) {
    const buckets = byRound.get(row.reset_date) ?? new Map<string, Set<string>>();
    const bucket = buckets.get(row.observed_at) ?? new Set<string>();
    bucket.add(row.agent_symbol);
    buckets.set(row.observed_at, bucket);
    byRound.set(row.reset_date, buckets);
  }

  const findings: IntegrityFinding[] = [];
  for (const resetDate of [...byRound.keys()].toSorted()) {
    const buckets = byRound.get(resetDate)!;
    const peakAgents = Math.max(...[...buckets.values()].map((s) => s.size));
    const finalObservedAt = [...buckets.keys()].toSorted().at(-1)!;
    const finalAgents = buckets.get(finalObservedAt)!.size;
    findings.push({
      reset_date: resetDate,
      peakAgents,
      finalAgents,
      incompleteFinal: finalAgents < threshold * peakAgents,
    });
  }
  return findings;
}

/** The distinct symbols that hold (or will hold) an `agents` row and so are rateable. */
function ratedSymbols(
  rows: readonly AgentSnapshotRow[],
  registerAll: boolean,
  alreadyRegistered: ReadonlySet<string>,
): Set<string> {
  const rated = new Set<string>();
  for (const row of rows) {
    if (registerAll ? isValidSymbol(row.agent_symbol) : alreadyRegistered.has(row.agent_symbol)) {
      rated.add(row.agent_symbol);
    }
  }
  return rated;
}

/** Read every symbol that already has an `agents` row. */
async function loadRegisteredSymbols(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT symbol FROM agents")
    .all<{ symbol: string }>();
  return new Set((results ?? []).map((r) => r.symbol));
}

/** Look up the import's archived season by label (there is at most one). */
async function findSeasonByLabel(
  db: D1Database,
  label: string,
): Promise<SeasonRow | null> {
  const row = await db
    .prepare(
      `SELECT id, label, cutoff_date, unranked_gap_days, closed_at, closed_round_id
       FROM seasons WHERE label = ? ORDER BY id ASC LIMIT 1`,
    )
    .bind(label)
    .first<SeasonRow>();
  return row ?? null;
}

/**
 * Validate that a pre-existing Season 0 (from a prior, possibly partial, run) matches THIS
 * run exactly, so a re-run is a safe idempotent continuation rather than a silent mismatch.
 * Throws on any divergence (wrong cutoff, non-zero gap, or a close on the wrong round).
 */
async function assertSeasonMatches(
  db: D1Database,
  season: SeasonRow,
  expectedCutoff: string,
): Promise<void> {
  if (season.cutoff_date !== expectedCutoff) {
    throw new Error(
      `import preflight: existing "${season.label}" has cutoff_date ${season.cutoff_date},` +
        ` expected ${expectedCutoff} (the latest legacy reset_date) — refusing to continue`,
    );
  }
  if (season.unranked_gap_days !== 0) {
    throw new Error(
      `import preflight: existing "${season.label}" has a non-zero unranked gap — refusing`,
    );
  }
  if (season.closed_at !== null && season.closed_round_id !== null) {
    const round = await db
      .prepare("SELECT reset_date FROM rounds WHERE id = ?")
      .bind(season.closed_round_id)
      .first<{ reset_date: string }>();
    if (round && round.reset_date !== expectedCutoff) {
      throw new Error(
        `import preflight: existing "${season.label}" closed on round ${round.reset_date},` +
          ` expected ${expectedCutoff} — the legacy data has changed; refusing to continue`,
      );
    }
  }
}

/** A simple `YYYY-MM-DD...` shape check; legacy reset_dates are ISO date(-time) strings. */
function isIsoDateLike(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * Run the read-only preflight gates. Throws (before any write) when the run would be unsafe.
 */
async function preflight(
  db: D1Database,
  args: {
    label: string;
    maxReset: string;
    launchResetDate: string;
    maxRatingPeriodAgents: number;
  },
): Promise<void> {
  const { label, launchResetDate, maxReset, maxRatingPeriodAgents } = args;

  if (!isIsoDateLike(launchResetDate)) {
    throw new Error(`import preflight: launchResetDate "${launchResetDate}" is not an ISO date`);
  }
  if (launchResetDate <= maxReset) {
    throw new Error(
      `import preflight: launchResetDate (${launchResetDate}) must be strictly AFTER the` +
        ` latest legacy reset_date (${maxReset}) so every legacy round is finalized`,
    );
  }

  if (maxRatingPeriodAgents + 1 > D1_MAX_BATCH) {
    throw new Error(
      `import preflight: a rating period would touch ${maxRatingPeriodAgents} agents, which` +
        ` exceeds the single-batch limit (${D1_MAX_BATCH - 1}). Reduce the rated field` +
        ` (registerAllAgents: false) or split rating application across batches first.`,
    );
  }

  const openSeason = await db
    .prepare("SELECT id, label FROM seasons WHERE closed_at IS NULL LIMIT 1")
    .first<{ id: number; label: string }>();
  if (openSeason && openSeason.label !== label) {
    throw new Error(
      `import preflight: a different season ("${openSeason.label}") is already open;` +
        ` refusing to import into it`,
    );
  }

  const existing = await findSeasonByLabel(db, label);
  if (existing) await assertSeasonMatches(db, existing, maxReset);
}

/**
 * Register an unclaimed `agents` row for each given symbol, in sorted order for stable ids.
 * INSERT OR IGNORE makes it idempotent. Returns the number of NEW rows created.
 */
async function registerAgents(
  db: D1Database,
  symbols: readonly string[],
): Promise<number> {
  let created = 0;
  for (const symbol of [...symbols].toSorted()) {
    const result = await db
      .prepare("INSERT OR IGNORE INTO agents (symbol) VALUES (?)")
      .bind(symbol)
      .run();
    created += result.meta?.changes ?? 0;
  }
  return created;
}

/** Ensure the archived Season 0 exists (open), returning its id. Idempotent. */
async function ensureSeason(
  db: D1Database,
  label: string,
  cutoff: string,
): Promise<number> {
  const existing = await findSeasonByLabel(db, label);
  if (existing) return existing.id;
  const row = await db
    .prepare(
      `INSERT INTO seasons (label, cutoff_date, unranked_gap_days)
       VALUES (?, ?, 0) RETURNING id`,
    )
    .bind(label, cutoff)
    .first<{ id: number }>();
  if (!row) throw new Error("import: season row missing after insert");
  return row.id;
}

/** Count the rounds that ended up finalized within the legacy reset range. */
async function countFinalizedRounds(
  db: D1Database,
  resetDates: readonly string[],
): Promise<number> {
  if (resetDates.length === 0) return 0;
  const placeholders = resetDates.map(() => "?").join(", ");
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM rounds
       WHERE finalized_at IS NOT NULL AND reset_date IN (${placeholders})`,
    )
    .bind(...resetDates)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Run the full legacy import against `db`. Pure-ish: it mutates `db` but performs NO network
 * or production-environment access. Returns a structured {@link ImportSummary} for the report.
 *
 * @param db        The DESTINATION rankings.trade database (a dry-run fixture, or — only under
 *                  the human-gated cutover — production).
 * @param legacy    Raw legacy snapshot rows (from {@link import("./legacy-source")}).
 * @param options   Run policy; `launchResetDate` is required.
 */
export async function runImport(
  db: D1Database,
  legacy: readonly LegacySnapshotRow[],
  options: ImportOptions,
): Promise<ImportSummary> {
  const label = options.seasonLabel ?? DEFAULT_SEASON_LABEL;
  const registerAll = options.registerAllAgents ?? false;
  const threshold = options.incompleteFinalThreshold ?? DEFAULT_INCOMPLETE_THRESHOLD;

  const { rows, dropped } = transformSnapshots(legacy);
  if (rows.length === 0) {
    throw new Error("import: the legacy export has no usable snapshot rows");
  }

  const resetDates = distinctResetDates(rows);
  const maxReset = resetDates.at(-1)!;
  const allSymbols = new Set(rows.map((r) => r.agent_symbol));
  const invalidSymbols = [...allSymbols].filter((s) => !isValidSymbol(s)).toSorted();

  const integrity = analyzeIntegrity(rows, threshold);
  if (options.failOnIncompleteFinal && integrity.some((f) => f.incompleteFinal)) {
    const bad = integrity.filter((f) => f.incompleteFinal).map((f) => f.reset_date);
    throw new Error(
      `import: incomplete final snapshot(s) for round(s) ${bad.join(", ")} and` +
        ` failOnIncompleteFinal is set — repair the legacy data or override`,
    );
  }

  const alreadyRegistered = await loadRegisteredSymbols(db);
  const rated = ratedSymbols(rows, registerAll, alreadyRegistered);
  const symbolsToRegister = registerAll
    ? [...allSymbols].filter((s) => isValidSymbol(s))
    : [];

  await preflight(db, {
    label,
    maxReset,
    launchResetDate: options.launchResetDate,
    maxRatingPeriodAgents: rated.size,
  });

  const agentsRegistered = await registerAgents(db, symbolsToRegister);
  await writeSnapshots(db, rows);
  const seasonId = await ensureSeason(db, label, maxReset);

  await finalizePendingRounds(db, options.launchResetDate, importSeams);

  const seasonRow = await db
    .prepare("SELECT closed_at FROM seasons WHERE id = ?")
    .bind(seasonId)
    .first<{ closed_at: string | null }>();
  const standings = await listSeasonStandings(db, seasonId);

  return {
    resetDates,
    snapshotRowsWritten: rows.length,
    snapshotRowsDropped: dropped.length,
    distinctSymbols: allSymbols.size,
    agentsRegistered,
    invalidSymbols,
    unratedSymbols: allSymbols.size - rated.size,
    seasonId,
    seasonClosed: (seasonRow?.closed_at ?? null) !== null,
    roundsFinalized: await countFinalizedRounds(db, resetDates),
    maxRatingPeriodAgents: rated.size,
    integrity,
    seasonStandings: standings.length,
  };
}
