/**
 * Rating-period expansion (Epic H, card H4) — pure, no DB.
 *
 * One finalized ranked round is treated as a single Glicko-2 rating period (DEC-1). This
 * module turns the round's final standings into updated ratings:
 *
 *   - PARTICIPANTS are expanded to an in-memory ROUND-ROBIN: every participant "plays"
 *     every other participant once, scoring 1 for more final credits, 0.5 for equal
 *     (a draw — the tie policy), 0 for fewer. Each participant is then updated ONCE
 *     against that set of outcomes. The pairwise outcomes are never materialized as rows
 *     (O(n²) compute, O(n) result), per the brief.
 *   - All updates read each player's PRE-period state and never the post-period state of
 *     another player in the same period — the simultaneous-update semantics Glicko-2
 *     requires. The caller passes pre-period states; this function does not mutate them.
 *   - NON-PARTICIPANTS (registered agents who already hold a season rating but sat this
 *     round out) get the "did not compete" RD-inflation update for the missed period.
 *
 * The result is the new state for every input agent, keyed by agent id.
 */

import type { Glicko2Config, RatingState } from "./config";
import type { Outcome } from "./glicko2";

import { GLICKO2_CONFIG } from "./config";
import { glicko2Update } from "./glicko2";

/** A participant in the round: their outcome metric and pre-period rating. */
export interface PeriodParticipant {
  agentId: number;
  /** Outcome source — higher beats lower, equal draws (final_credits). */
  finalCredits: number;
  /** Pre-period rating state (baseline if this is their first rated round). */
  state: RatingState;
}

/** A registered agent who did not participate but already has a season rating. */
export interface PeriodIdle {
  agentId: number;
  state: RatingState;
}

/** The new state to persist for one agent after the period. */
export interface PeriodResult {
  agentId: number;
  state: RatingState;
}

/** Score of `a` against `b` from their final credits: 1 win / 0.5 draw / 0 loss. */
function pairwiseScore(a: number, b: number): number {
  if (a > b) return 1;
  if (a < b) return 0;
  return 0.5;
}

/**
 * Compute every agent's new rating for one rating period.
 *
 * @param participants Agents that participated, with pre-period state and final credits.
 * @param idle Registered agents with an existing season rating who did not participate.
 * @param config Glicko-2 constants (defaults to the locked production config).
 */
export function computeRatingPeriod(
  participants: readonly PeriodParticipant[],
  idle: readonly PeriodIdle[],
  config: Glicko2Config = GLICKO2_CONFIG,
): PeriodResult[] {
  const results: PeriodResult[] = [];

  for (const [i, player] of participants.entries()) {
    const outcomes: Outcome[] = [];
    for (const [j, opponent] of participants.entries()) {
      if (i === j) continue;
      outcomes.push({
        opponent: opponent.state,
        score: pairwiseScore(player.finalCredits, opponent.finalCredits),
      });
    }
    results.push({
      agentId: player.agentId,
      state: glicko2Update(player.state, outcomes, config),
    });
  }

  for (const sitter of idle) {
    results.push({
      agentId: sitter.agentId,
      state: glicko2Update(sitter.state, [], config),
    });
  }

  return results;
}
