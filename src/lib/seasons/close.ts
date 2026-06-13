/**
 * The production season-close seams (Epic I): {@link seasonCloseEvaluator} decides whether a
 * finalized round closes the open season, and {@link seasonCloseTrigger} runs the close side
 * effects. Both are composed into production in src/lib/scrape/scheduled.ts.
 *
 * CLOSE CONDITION: the open season closes at the FIRST universe reset on or after its
 * cutoff_date. The evaluator returns true when the round is ranked (so it carries the open
 * season's id), that season is still open, and the round's reset_date ≥ cutoff_date. The
 * "first" qualifier is automatic: once a season closes it is no longer the open season, so
 * later resets resolve to the next season (or unranked) and never re-close it.
 *
 * SIDE EFFECTS (idempotent, ordered): the Epic G orchestrator runs the rating trigger BEFORE
 * this, so the closing round's ratings are already folded into the season. onSeasonClose then:
 *   1. archives every rated agent's final rating/rank/title (deterministic UPSERT — a replay
 *      after a partial crash repairs the archive rather than ignoring it);
 *   2. stamps the season closed via a single-winner conditional update (guarded by
 *      `closed_at IS NULL`), recording the closing round and the unranked-gap boundary.
 * The stamp is LAST, so a crash mid-archive simply re-runs the whole archive on replay. The
 * trigger has NO external side effects, so a (re-)entry by the recovery sweep is safe.
 *
 * BASELINE RESET is structural, not destructive: ratings are keyed by (agent_id, season_id),
 * so the next season's first ranked round resolves to a NEW season_id whose ratings start
 * empty = baseline. The closed season's rating rows are retained as history. (Consumers of
 * "current" ratings MUST therefore scope by the open season's id — see getOpenSeason.)
 */

import type { Round } from "../db/rounds";
import type { Season } from "../db/seasons";
import type { SeasonCloseEvaluator, SeasonCloseTrigger } from "../rounds/seams";

import { closeSeason, getSeasonById, upsertSeasonStandings } from "../db/seasons";
import { computeSeasonStandings } from "./standings";

/**
 * The first ranked reset_date after the gap: the closing round's date plus `gapDays`. Returns
 * null when `gapDays` is 0 (no gap window). Computed on the date portion of the reset_date so
 * it stays comparable to the natural-key ordering used elsewhere.
 */
export function unrankedUntilFor(
  closingResetDate: string,
  gapDays: number,
): string | null {
  if (gapDays <= 0) return null;
  const date = new Date(`${closingResetDate.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + gapDays);
  return date.toISOString().slice(0, 10);
}

/** Resolve the season a round closes, if any (ranked round whose open season's cutoff passed). */
async function closingSeasonFor(
  db: D1Database,
  round: Round,
): Promise<Season | null> {
  if (round.season_id === null) return null;
  const season = await getSeasonById(db, round.season_id);
  if (!season || season.closed_at !== null) return null;
  return round.reset_date >= season.cutoff_date ? season : null;
}

/** Production close evaluator: true when this finalized round closes the open season. */
export const seasonCloseEvaluator: SeasonCloseEvaluator = {
  async shouldCloseSeason(db: D1Database, round: Round): Promise<boolean> {
    return (await closingSeasonFor(db, round)) !== null;
  },
};

/** Production close trigger: archive the season's final standings, then stamp it closed. */
export const seasonCloseTrigger: SeasonCloseTrigger = {
  async onSeasonClose(db: D1Database, round: Round): Promise<void> {
    const season = await closingSeasonFor(db, round);
    // Re-check under the same guard the evaluator used; a replay after the stamp is a no-op.
    if (season === null) return;

    const standings = await computeSeasonStandings(db, season.id);
    await upsertSeasonStandings(db, standings);

    await closeSeason(db, {
      seasonId: season.id,
      closedRoundId: round.id,
      unrankedUntil: unrankedUntilFor(round.reset_date, season.unranked_gap_days),
    });
  },
};
