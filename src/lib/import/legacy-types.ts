/**
 * Port-boundary types for the legacy SpaceJam → rankings.trade import (Epic K).
 *
 * The legacy SpaceJam leaderboard stored periodic captures of EVERY public SpaceTraders
 * agent in a `snapshots` table whose shape predates rankings.trade's schema. This module
 * defines the LOOSE legacy row that the importer consumes and the knobs that drive the
 * one-time import. Keeping the legacy shape permissive (extra columns tolerated, several
 * optional) lets the importer ingest a raw SQL dump, a sqlite file, or a JSON export
 * without coupling to one exporter — `transform.ts` is the single place that maps it onto
 * the current `snapshots` contract (dropping net-worth and the chart columns).
 *
 * @see migrations/0010_snapshots.sql — the destination schema.
 * @see docs/runbooks/k-cutover.md — the human-gated cutover procedure.
 */

/**
 * One raw legacy snapshot row, as found in the old `snapshots` table.
 *
 * Only the fields the import actually uses are modelled; any other columns present in the
 * export (e.g. an autoincrement `id`) are ignored. `chart_count`/`chart_rank` and a
 * historical `net_worth` estimate are intentionally accepted-then-DROPPED by the transform
 * (they are not part of rankings.trade's ranking model — credits is the sole metric).
 */
export interface LegacySnapshotRow {
  reset_date: string;
  observed_at: string;
  agent_symbol: string;
  credits: number | null;
  credit_rank: number | null;
  total_agents: number | null;
  ship_count: number | null;
  /** Dropped by the transform; tolerated if present in the export. */
  chart_count?: number | null;
  /** Dropped by the transform; tolerated if present in the export. */
  chart_rank?: number | null;
  /** Dropped by the transform; tolerated if a much older export carried it. */
  net_worth?: number | null;
  /** Tolerated if a later export already carried the current `faction` column. */
  faction?: string | null;
}

/**
 * Policy knobs for one import run. All are deterministic inputs — the same legacy export
 * plus the same options yields the same (semantic) database state.
 */
export interface ImportOptions {
  /**
   * The live universe `resetDate` at the moment of cutover. Every legacy reset_date must be
   * strictly EARLIER than this so the legacy rounds are all "ended" and get finalized. In a
   * dry-run this is a sentinel lexicographically greater than every legacy reset_date.
   */
  launchResetDate: string;
  /**
   * Label for the archived pre-launch season. Defaults to `"Season 0"`.
   */
  seasonLabel?: string;
  /**
   * When true, register an unclaimed `agents` row for EVERY distinct legacy symbol so the
   * genesis rating replay covers the full historical field. DANGER: the legacy export holds
   * every public agent (hundreds+), and one Glicko rating period must fit in a single D1
   * batch (≤ 99 rated agents); the importer's preflight HARD-FAILS if this would be
   * exceeded. Defaults to FALSE — rate only already-registered agents (the seeded starter
   * crew), matching live production (only claimed agents are rated).
   */
  registerAllAgents?: boolean;
  /**
   * Fraction of a round's peak observed agent count below which its FINAL observation bucket
   * is treated as "incomplete" (a data-quality flag, see {@link IntegrityFinding}). Default
   * 0.5 (final bucket smaller than half the round's peak is flagged).
   */
  incompleteFinalThreshold?: number;
  /**
   * When true, a severe incomplete-final-snapshot finding aborts the run before any rounds
   * are finalized. Defaults to FALSE (flag-and-report; the human reviews in the runbook).
   */
  failOnIncompleteFinal?: boolean;
}

/** A data-quality finding for one reconstructed round. */
export interface IntegrityFinding {
  reset_date: string;
  /** Distinct agents at the round's largest observation bucket. */
  peakAgents: number;
  /** Distinct agents at the round's FINAL (last) observation bucket — the frozen standing. */
  finalAgents: number;
  /** True when `finalAgents` fell below `incompleteFinalThreshold * peakAgents`. */
  incompleteFinal: boolean;
}

/** A structured, side-effect-free summary of one import run (for the dry-run report). */
export interface ImportSummary {
  /** Distinct legacy reset_dates discovered, chronological. */
  resetDates: string[];
  /** Legacy snapshot rows after transform (the rows written). */
  snapshotRowsWritten: number;
  /** Legacy rows dropped by the transform (unknown credits). */
  snapshotRowsDropped: number;
  /** Distinct, valid legacy symbols seen. */
  distinctSymbols: number;
  /** New `agents` rows created by this run. */
  agentsRegistered: number;
  /** Symbols rejected for failing the `agents.symbol` CHECK (still kept as snapshots). */
  invalidSymbols: string[];
  /** Symbols present in snapshots that hold NO `agents` row ⇒ unrated (history only). */
  unratedSymbols: number;
  /** The archived season's id, or null if it was not (re)created this run. */
  seasonId: number | null;
  /** Whether the archived season ended this run closed (archived). */
  seasonClosed: boolean;
  /** Rounds reconstructed + finalized in this sweep. */
  roundsFinalized: number;
  /** The worst-case agents a single rating period would touch (drives the batch gate). */
  maxRatingPeriodAgents: number;
  /** Per-round data-quality findings. */
  integrity: IntegrityFinding[];
  /** Archived Season-0 standings count (rated agents at close). */
  seasonStandings: number;
}
