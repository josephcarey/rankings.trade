/**
 * Synthetic legacy SpaceJam dataset for dry-run testing of the Epic K import.
 *
 * This is NOT the real legacy export — it is a small, hand-built fixture that exercises
 * every branch the import must handle deterministically:
 *
 *   - THREE reset_dates (rounds) in non-sorted source order, to prove chronological
 *     reconstruction does not depend on input ordering.
 *   - Multiple `observed_at` buckets per round, so "final standing = the LAST observation"
 *     is actually exercised (not just a single-bucket round).
 *   - Dropped columns present (`chart_count`/`chart_rank`, and a legacy `net_worth` on a few
 *     rows) to prove the transform discards them.
 *   - A mix of CREW symbols (which the seed migration 0005 registers, so they are rated) and
 *     UNREGISTERED public agents (history-only, unrated) — the production-consistent default.
 *   - An INCOMPLETE FINAL bucket on the last round (two crew agents vanish from the final
 *     observation) to exercise the missing-final-snapshot behavior + integrity flag.
 *   - A row with NULL credits (an agent observed without a credits reading) to prove the
 *     transform drops it.
 *
 * The crew symbols intentionally match migrations/0005_seed_spacejam_league.sql so a freshly
 * migrated database already holds their `agents` rows.
 */

import type { LegacySnapshotRow } from "../legacy-types";

/** Build one legacy row, with the dropped columns populated so the transform can strip them. */
function row(
  resetDate: string,
  observedAt: string,
  symbol: string,
  credits: number | null,
  rank: number,
  ships: number,
  totalAgents: number,
  extra: Partial<LegacySnapshotRow> = {},
): LegacySnapshotRow {
  return {
    reset_date: resetDate,
    observed_at: observedAt,
    agent_symbol: symbol,
    credits,
    credit_rank: rank,
    ship_count: ships,
    total_agents: totalAgents,
    chart_count: 3,
    chart_rank: 1,
    ...extra,
  };
}

/**
 * The fixture rows, deliberately emitted in a NON-chronological round order (the middle round
 * first) so tests prove the import sorts by reset_date rather than trusting input order.
 */
export const legacyFixture: LegacySnapshotRow[] = [
  // --- Round 2 (2024-11-15): two buckets, full field of 4 crew at the final bucket. ---
  row("2024-11-15", "2024-11-15T00:00", "BAMES_JOND", 5000, 1, 3, 4),
  row("2024-11-15", "2024-11-15T00:00", "JBARHORST", 4000, 2, 2, 4),
  row("2024-11-15", "2024-11-15T00:00", "OLSON_AGENT", 3000, 3, 2, 4),
  row("2024-11-15", "2024-11-15T00:00", "SPARKY", 2000, 4, 1, 4),
  // final bucket — JBARHORST overtakes BAMES_JOND (order matters for ratings).
  row("2024-11-15", "2024-11-15T12:00", "BAMES_JOND", 6000, 2, 3, 4),
  row("2024-11-15", "2024-11-15T12:00", "JBARHORST", 9000, 1, 4, 4),
  row("2024-11-15", "2024-11-15T12:00", "OLSON_AGENT", 3500, 3, 2, 4),
  row("2024-11-15", "2024-11-15T12:00", "SPARKY", 2500, 4, 1, 4),

  // --- Round 1 (2024-11-01): the genesis round. Crew + one unregistered public agent. ---
  row("2024-11-01", "2024-11-01T00:00", "BAMES_JOND", 1000, 1, 1, 3, { net_worth: 1500 }),
  row("2024-11-01", "2024-11-01T00:00", "JBARHORST", 800, 2, 1, 3, { net_worth: 900 }),
  row("2024-11-01", "2024-11-01T00:00", "RANDO_PUBLIC", 700, 3, 1, 3),
  // final bucket — a tie between BAMES_JOND and JBARHORST (a draw in Glicko terms).
  row("2024-11-01", "2024-11-01T12:00", "BAMES_JOND", 5000, 1, 2, 3),
  row("2024-11-01", "2024-11-01T12:00", "JBARHORST", 5000, 1, 2, 3),
  row("2024-11-01", "2024-11-01T12:00", "RANDO_PUBLIC", 1200, 3, 1, 3),
  // a malformed reading with unknown credits — the transform must DROP this row.
  row("2024-11-01", "2024-11-01T12:00", "GHOST_AGENT", null, 4, 0, 3),

  // --- Round 3 (2024-12-01): the FINAL round (closes Season 0). Incomplete final bucket. ---
  row("2024-12-01", "2024-12-01T00:00", "BAMES_JOND", 7000, 1, 4, 4),
  row("2024-12-01", "2024-12-01T00:00", "JBARHORST", 6500, 2, 4, 4),
  row("2024-12-01", "2024-12-01T00:00", "OLSON_AGENT", 6000, 3, 3, 4),
  row("2024-12-01", "2024-12-01T00:00", "SPARKY", 5500, 4, 2, 4),
  // INCOMPLETE final bucket: only 1 of the 4 agents was captured at the last observation.
  row("2024-12-01", "2024-12-01T12:00", "BAMES_JOND", 8000, 1, 5, 1),
];

/** The crew symbols the fixture shares with migration 0005 (registered ⇒ rated by default). */
export const fixtureCrewSymbols = [
  "BAMES_JOND",
  "JBARHORST",
  "OLSON_AGENT",
  "SPARKY",
] as const;
