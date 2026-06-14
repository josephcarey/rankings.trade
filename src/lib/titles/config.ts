/**
 * Title ladder configuration (Epic I, design lock — see docs/decisions.md DEC-2 / DEC-I1).
 *
 * Every tunable for the space-themed rank ladder lives here so tiers can be re-tuned after a
 * live season without touching the assignment algorithm or the season/close wiring (the same
 * single-config-module pattern Epic H uses for the Glicko-2 constants). The locked inputs:
 *
 *   - The brief's ladder, bottom → top: Cadet → Ensign → Lieutenant → Commander → Captain →
 *     Commodore → Colonel → Admiral → Fleet Admiral.
 *   - The lower SIX tiers are FIXED-THRESHOLD: an agent gets the highest tier whose lower
 *     rating threshold it clears.
 *   - The top THREE tiers (Colonel, Admiral, Fleet Admiral) are ELITE: a percentile band that
 *     expands/contracts with the player count AND an absolute minimum-rating gate, so elite
 *     slots stay empty in a small or weak field until someone clears the threshold.
 *   - Every tier additionally requires the established-rating FLOOR (RD below a cap and a
 *     minimum number of ranked rounds); an agent below the floor gets NO title.
 *
 * Percentile is computed as the fraction of the established, ranked population rated STRICTLY
 * BELOW the agent (so ties share a percentile and the same tier). A consequence of the locked
 * bands: Fleet Admiral first appears at N ≥ 50, Admiral at N ≥ 10, Colonel at N ≥ 4 (a single
 * unique top agent has percentile (N-1)/N). Recalibrate after season 1.
 */

/** A fixed lower-rating-threshold tier: earned by clearing {@link minRating}. */
interface ThresholdTier {
  readonly kind: "threshold";
  readonly name: string;
  /** Inclusive lower rating bound for this tier. */
  readonly minRating: number;
}

/** An elite tier: top {@link minPercentile} of the field AND rating ≥ {@link minRatingGate}. */
interface PercentileTier {
  readonly kind: "percentile";
  readonly name: string;
  /** Fraction of the population that must be rated strictly below the agent (0–1). */
  readonly minPercentile: number;
  /** Absolute rating floor — the gate that keeps elite slots empty in a weak field. */
  readonly minRatingGate: number;
}

type TitleTier = PercentileTier | ThresholdTier;

/** The established-rating floor every tier requires (DEC-I1). */
interface EstablishedFloor {
  /** Maximum rating deviation: an agent must be at or below this to be "established". */
  readonly maxRd: number;
  /** Minimum ranked rounds participated in this season. */
  readonly minRankedRounds: number;
}

export interface TitleConfig {
  readonly establishedFloor: EstablishedFloor;
  /** Tiers ordered HIGHEST → LOWEST; assignment picks the first one the agent qualifies for. */
  readonly tiers: readonly TitleTier[];
}

/** The locked production title ladder (DEC-2 / DEC-I1). */
export const TITLE_CONFIG: TitleConfig = {
  // Season-1 recalibration of the design-locked DEC-I1 RD cap (100 → 110): empirically RD is
  // ~162 after round 1 and tightens to ~101 by round 3, so a 110 cap makes the ≥3-ranked-rounds
  // rule the binding gate and titles reliably appear at round 3 instead of slipping to round 4.
  establishedFloor: { maxRd: 110, minRankedRounds: 3 },
  tiers: [
    { kind: "percentile", minPercentile: 0.98, minRatingGate: 2200, name: "Fleet Admiral" },
    { kind: "percentile", minPercentile: 0.9, minRatingGate: 2000, name: "Admiral" },
    { kind: "percentile", minPercentile: 0.75, minRatingGate: 1850, name: "Colonel" },
    { kind: "threshold", minRating: 1750, name: "Commodore" },
    { kind: "threshold", minRating: 1650, name: "Captain" },
    { kind: "threshold", minRating: 1550, name: "Commander" },
    { kind: "threshold", minRating: 1450, name: "Lieutenant" },
    { kind: "threshold", minRating: 1350, name: "Ensign" },
    { kind: "threshold", minRating: 0, name: "Cadet" },
  ],
};
