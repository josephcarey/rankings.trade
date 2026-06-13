/**
 * Pure Glicko-2 core (Epic H, card H2).
 *
 * A direct, side-effect-free implementation of Mark Glickman's Glicko-2 system
 * ("Example of the Glicko-2 system", glicko.net/glicko/glicko2.pdf). It has NO database
 * or rounds knowledge — it operates on {@link RatingState} values and explicit
 * parameters so it can be unit-tested against the paper's published worked example
 * (which uses τ = 0.5). Production passes {@link GLICKO2_CONFIG} (τ = 0.6) instead.
 *
 * Two operations are exposed:
 *   - {@link glicko2Update}: update a player against the outcomes of one rating period.
 *     With an empty outcome list this reduces to the "did not compete" RD-inflation
 *     update, so non-participants share the exact same code path.
 *   - {@link inflateIdleRd}: the explicit no-games update, for readability at call sites.
 *
 * Results are clamped to the configured RD band [rdFloor, initialRd] so an established
 * rating never freezes (floor) and an idle/unrated one never exceeds the baseline (cap).
 */

import type { Glicko2Config, RatingState } from "./config";

import { GLICKO2_CONFIG } from "./config";

/** One opponent faced in a rating period, with the player's score against them. */
export interface Outcome {
  /** Opponent's pre-period state (Glicko-1 scale). */
  opponent: RatingState;
  /** Player's score vs this opponent: 1 win, 0.5 draw, 0 loss. */
  score: number;
}

/** Glicko-2 scale state: μ (rating) and φ (deviation). */
interface Glicko2Scale {
  mu: number;
  phi: number;
}

/** Convert a Glicko-1 state to the internal Glicko-2 scale. */
function toScale(state: RatingState, config: Glicko2Config): Glicko2Scale {
  return {
    mu: (state.rating - config.initialRating) / config.scale,
    phi: state.rd / config.scale,
  };
}

/** g(φ): how much an opponent's deviation discounts a result. */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** E(μ, μ_j, φ_j): expected score of the player against opponent j. */
function expectedScore(mu: number, oppMu: number, oppPhi: number): number {
  return 1 / (1 + Math.exp(-g(oppPhi) * (mu - oppMu)));
}

/** Clamp RD into the configured [rdFloor, initialRd] band. */
function clampRd(rd: number, config: Glicko2Config): number {
  return Math.min(config.initialRd, Math.max(config.rdFloor, rd));
}

/**
 * Solve for the new volatility σ' via the Illinois variant of regula falsi (paper Step 5).
 */
function newVolatility(
  sigma: number,
  delta: number,
  phi: number,
  v: number,
  config: Glicko2Config,
): number {
  const { convergenceTolerance: eps, tau } = config;
  const a = Math.log(sigma * sigma);
  const deltaSq = delta * delta;
  const phiSq = phi * phi;

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const denom = phiSq + v + ex;
    return (ex * (deltaSq - denom)) / (2 * denom * denom) - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > eps) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

/**
 * Update a player against the outcomes of a single rating period.
 *
 * An empty `outcomes` list is the "did not compete" case: rating and volatility are
 * unchanged and only RD inflates by φ* = sqrt(φ² + σ²) (paper §"did not compete").
 */
export function glicko2Update(
  state: RatingState,
  outcomes: readonly Outcome[],
  config: Glicko2Config = GLICKO2_CONFIG,
): RatingState {
  const { mu, phi } = toScale(state, config);

  if (outcomes.length === 0) {
    const phiStar = Math.sqrt(phi * phi + state.volatility * state.volatility);
    return {
      rating: state.rating,
      rd: clampRd(phiStar * config.scale, config),
      volatility: state.volatility,
    };
  }

  const opponents = outcomes.map((o) => {
    const scaled = toScale(o.opponent, config);
    const e = expectedScore(mu, scaled.mu, scaled.phi);
    return { e, gPhi: g(scaled.phi), score: o.score };
  });

  // Step 3: estimated variance v.
  const vInv = opponents.reduce(
    (sum, o) => sum + o.gPhi * o.gPhi * o.e * (1 - o.e),
    0,
  );
  const v = 1 / vInv;

  // Step 4: estimated improvement Δ (and its un-scaled inner sum, reused in Step 7).
  const ratingSum = opponents.reduce((sum, o) => sum + o.gPhi * (o.score - o.e), 0);
  const delta = v * ratingSum;

  // Step 5–6: new volatility and the pre-rating-period deviation φ*.
  const sigmaPrime = newVolatility(state.volatility, delta, phi, v, config);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);

  // Step 7: new deviation and rating on the Glicko-2 scale.
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * ratingSum;

  // Step 8: back to the Glicko-1 scale.
  return {
    rating: muPrime * config.scale + config.initialRating,
    rd: clampRd(phiPrime * config.scale, config),
    volatility: sigmaPrime,
  };
}

/** The explicit "did not compete this period" RD-inflation update (non-participants). */
export function inflateIdleRd(
  state: RatingState,
  config: Glicko2Config = GLICKO2_CONFIG,
): RatingState {
  return glicko2Update(state, [], config);
}
