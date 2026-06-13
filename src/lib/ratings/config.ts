/**
 * Glicko-2 system constants (Epic H, design lock — see docs/decisions.md DEC-1 + DEC-H1).
 *
 * Every tunable lives here so the rating system can be recalibrated after the first live
 * season without touching algorithm or wiring code. The locked values come from DEC-1:
 *
 *   - Baseline rating 1500, RD 350, volatility σ 0.06.
 *   - τ (system constant) raised 0.5 → 0.6 for slightly more reactivity to upsets.
 *   - One rating period per finalized round; equal credits = draw (a 0.5 outcome).
 *   - An RD floor so established players never freeze between rounds (DEC-H1 locks the
 *     numeric value at 30 — recalibrate after season 1).
 *
 * The pure Glicko-2 core ({@link ./glicko2}) takes its parameters explicitly (τ,
 * convergence tolerance, scale) so it can be unit-tested against the published reference
 * vectors, which use τ = 0.5. Production wires {@link GLICKO2_CONFIG} through instead.
 */

/** A player's Glicko-2 state on the human-facing (Glicko-1) scale. */
export interface RatingState {
  rating: number;
  rd: number;
  volatility: number;
}

export interface Glicko2Config {
  /** Baseline rating for an unrated player (Glicko-1 scale). */
  readonly initialRating: number;
  /** Baseline rating deviation; also the upper cap RD never exceeds. */
  readonly initialRd: number;
  /** Baseline volatility σ. */
  readonly initialVolatility: number;
  /** System constant τ: constrains the volatility change over time. */
  readonly tau: number;
  /**
   * Lower bound on RD after an update, so an established rating keeps moving between
   * the infrequent rounds rather than freezing (DEC-1). Must be ≤ {@link initialRd}.
   */
  readonly rdFloor: number;
  /** Glicko-1 ↔ Glicko-2 scale factor (the paper's 173.7178). */
  readonly scale: number;
  /** Iteration tolerance ε for the volatility solver (the paper uses 1e-6). */
  readonly convergenceTolerance: number;
}

/** The locked production configuration (DEC-1 / DEC-H1). */
export const GLICKO2_CONFIG: Glicko2Config = {
  convergenceTolerance: 0.000_001,
  initialRating: 1500,
  initialRd: 350,
  initialVolatility: 0.06,
  rdFloor: 30,
  scale: 173.7178,
  tau: 0.6,
};

/** A fresh, unrated player's state at the configured baseline. */
export function baselineState(config: Glicko2Config = GLICKO2_CONFIG): RatingState {
  return {
    rating: config.initialRating,
    rd: config.initialRd,
    volatility: config.initialVolatility,
  };
}
