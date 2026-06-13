/**
 * Title assignment (Epic I) — pure, no DB.
 *
 * Turns a season's rated population into a title per agent, using the locked ladder
 * ({@link TITLE_CONFIG}). The rules (DEC-2 / DEC-I1):
 *
 *   - ESTABLISHED FLOOR first: an agent whose RD exceeds the cap, or who has played fewer
 *     than the minimum ranked rounds, is NOT established and gets a `null` title. Only
 *     established agents form the population that percentiles are computed over.
 *   - PERCENTILE (elite tiers): an agent's percentile is the fraction of the established
 *     population rated STRICTLY BELOW it. Ties therefore share a percentile (and a tier),
 *     so the assignment never splits equal ratings arbitrarily. An elite tier also requires
 *     the agent's rating to clear the tier's absolute gate.
 *   - THRESHOLD (lower tiers): earned by clearing the tier's fixed lower rating bound.
 *   - An agent receives the HIGHEST tier (config order is high → low) it qualifies for. The
 *     bottom tier (Cadet, minRating 0) is the catch-all for every established agent.
 *
 * Edge cases are handled by the formula, not special-casing: an empty population yields no
 * titles; a single agent has percentile 0 so it never reaches an elite band (it falls to a
 * threshold tier on its raw rating); a uniformly-tied field shares one percentile.
 */

import type { TitleConfig } from "./config";

import { TITLE_CONFIG } from "./config";

/** One agent's inputs for title assignment. */
export interface TitleInput {
  readonly agentId: number;
  readonly rating: number;
  readonly rd: number;
  /** Ranked rounds the agent participated in this season. */
  readonly rankedRounds: number;
}

/** The assigned title for one agent (`title` is null when not established). */
export interface TitleResult {
  readonly agentId: number;
  readonly established: boolean;
  readonly title: string | null;
}

/** True when the agent clears the established-rating floor (RD cap + min ranked rounds). */
export function isEstablished(input: TitleInput, config: TitleConfig = TITLE_CONFIG): boolean {
  const { maxRd, minRankedRounds } = config.establishedFloor;
  return input.rd <= maxRd && input.rankedRounds >= minRankedRounds;
}

/**
 * Assign a title to every input agent.
 *
 * Percentiles are computed over the established sub-population only (unestablished agents are
 * excluded from both the population size and the strictly-below counts). The result preserves
 * the input order and includes every agent (unestablished ones with a `null` title).
 */
export function computeTitles(
  inputs: readonly TitleInput[],
  config: TitleConfig = TITLE_CONFIG,
): TitleResult[] {
  const established = inputs.filter((a) => isEstablished(a, config));
  const populationSize = established.length;
  const ratings = established.map((a) => a.rating);

  return inputs.map((agent) => {
    if (!isEstablished(agent, config)) {
      return { agentId: agent.agentId, established: false, title: null };
    }

    const strictlyBelow = ratings.filter((r) => r < agent.rating).length;
    // populationSize >= 1 here (this agent is established), so the divisor is never 0.
    const percentile = strictlyBelow / populationSize;

    const tier = config.tiers.find((t) =>
      t.kind === "threshold"
        ? agent.rating >= t.minRating
        : percentile >= t.minPercentile && agent.rating >= t.minRatingGate,
    );

    return { agentId: agent.agentId, established: true, title: tier?.name ?? null };
  });
}
