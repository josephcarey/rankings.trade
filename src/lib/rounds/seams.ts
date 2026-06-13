/**
 * Finalization seams for the downstream epics (Epic G provides the hooks; Epics H
 * and I implement against them).
 *
 * Epic G deliberately implements NONE of the rating or season logic. It exposes four
 * narrow interfaces and ships inert defaults so the pipeline runs end-to-end today:
 *
 *   - {@link SeasonResolver} tags a round at finalization. The default reports
 *     `{ seasonId: null, isRanked: false }` because no season system exists yet, so
 *     rounds are archived but unranked (excluded from ratings) until Epic I supplies a
 *     real resolver. CONTRACT: a resolver that returns `isRanked: true` MUST return a
 *     non-null `seasonId` (a ranked round is always season-scoped — enforced by the DB
 *     CHECK and re-checked in finalize.ts).
 *   - {@link RatingTrigger} is called once per finalized RANKED round (Epic H). The
 *     rating period's outcomes are derived from `final_credits` (equal credits = draw),
 *     over `listRateableUniverseStandings` (registered, participating agents). It MUST
 *     be idempotent: it can be re-invoked after a crash before its completion marker
 *     (`rounds.ratings_applied_at`) is set.
 *   - {@link SeasonCloseEvaluator} decides whether a finalized round closes the open
 *     season (Epic I — "first reset on/after the cutoff"). The default returns false.
 *   - {@link SeasonCloseTrigger} runs the season-close side effects (Epic I). It MUST
 *     be idempotent for the same reason as the rating trigger.
 */

import type { Round } from "../db/rounds";

/** Tags a round with its season + ranked flag at finalization. */
export interface SeasonResolver {
  resolve(
    db: D1Database,
    resetDate: string,
  ): Promise<{ isRanked: boolean; seasonId: number | null }>;
}

/** Epic H seam: compute ratings for one finalized ranked round. Must be idempotent. */
export interface RatingTrigger {
  onRankedRoundFinalized(db: D1Database, round: Round): Promise<void>;
}

/** Epic I seam: decide whether a finalized round triggers a season close. */
export interface SeasonCloseEvaluator {
  shouldCloseSeason(db: D1Database, round: Round): Promise<boolean>;
}

/** Epic I seam: run the season-close side effects. Must be idempotent. */
export interface SeasonCloseTrigger {
  onSeasonClose(db: D1Database, round: Round): Promise<void>;
}

/** The full set of injectable finalization seams. */
export interface FinalizationSeams {
  ratingTrigger: RatingTrigger;
  seasonCloseEvaluator: SeasonCloseEvaluator;
  seasonCloseTrigger: SeasonCloseTrigger;
  seasonResolver: SeasonResolver;
}

/** No season system yet ⇒ every round is unranked and untagged. */
const defaultSeasonResolver: SeasonResolver = {
  resolve: () => Promise.resolve({ isRanked: false, seasonId: null }),
};

/** Inert until Epic H lands. */
const noopRatingTrigger: RatingTrigger = {
  onRankedRoundFinalized: () => Promise.resolve(),
};

/** No seasons ⇒ never close. */
const defaultSeasonCloseEvaluator: SeasonCloseEvaluator = {
  shouldCloseSeason: () => Promise.resolve(false),
};

/** Inert until Epic I lands. */
const noopSeasonCloseTrigger: SeasonCloseTrigger = {
  onSeasonClose: () => Promise.resolve(),
};

/** The inert default seams used in production until Epics H and I are wired in. */
export const defaultFinalizationSeams: FinalizationSeams = {
  ratingTrigger: noopRatingTrigger,
  seasonCloseEvaluator: defaultSeasonCloseEvaluator,
  seasonCloseTrigger: noopSeasonCloseTrigger,
  seasonResolver: defaultSeasonResolver,
};
