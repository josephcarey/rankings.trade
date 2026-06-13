/**
 * The production {@link RatingTrigger} (Epic H, card H5).
 *
 * The Epic G finalization orchestrator calls {@link GlickoRatingTrigger.onRankedRoundFinalized}
 * once per finalized RANKED round. This trigger turns that round's Universe standings into
 * one Glicko-2 rating period and writes the result to the season-scoped `ratings` table.
 *
 * It is wired into production in `src/lib/scrape/scheduled.ts` via
 * `{ ...defaultFinalizationSeams, ratingTrigger: glickoRatingTrigger }`.
 *
 * Correctness guarantees:
 *   - RANKED-ONLY: guards `round.is_ranked === 1` even though the orchestrator only calls it
 *     for ranked rounds, and requires the ranked⇒season invariant (`season_id` non-null).
 *   - IDEMPOTENT: a `rating_periods` marker row, written atomically with the rating updates,
 *     makes a re-invocation after a crash (before `rounds.ratings_applied_at` is set) a no-op.
 *   - CHRONOLOGICAL: refuses to apply a round while an earlier ranked round in the same
 *     season is still unapplied (Glicko-2 is order-dependent). It throws so the orchestrator
 *     does NOT mark the round applied; the pending-trigger sweep, which runs in id order,
 *     then heals the ordering on its next pass.
 *   - REGISTERED-ONLY: rates only `listRateableUniverseStandings` (participated, non-null
 *     agent_id); non-participants who already hold a season rating get RD inflation.
 */

import type { Round } from "../db/rounds";
import type { RatingTrigger } from "../rounds/seams";
import type { Glicko2Config, RatingState } from "./config";
import type { PeriodIdle, PeriodParticipant } from "./rating-period";

import {
  applyRatingPeriod,
  hasEarlierUnappliedRankedRound,
  isRatingPeriodApplied,
  listSeasonRatings,
  type RatingUpdate,
} from "../db/ratings";
import { listRateableUniverseStandings } from "../db/rounds";
import { baselineState, GLICKO2_CONFIG } from "./config";
import { computeRatingPeriod } from "./rating-period";

/** Configurable Glicko-2 rating trigger; production uses {@link glickoRatingTrigger}. */
export function createGlickoRatingTrigger(
  config: Glicko2Config = GLICKO2_CONFIG,
): RatingTrigger {
  return {
    async onRankedRoundFinalized(db: D1Database, round: Round): Promise<void> {
      // Guard: the orchestrator only calls this for ranked rounds, but assert anyway.
      if (round.is_ranked !== 1) return;
      if (round.season_id === null) {
        throw new Error(
          `glickoRatingTrigger: ranked round ${round.id} has no season_id`,
        );
      }
      const seasonId = round.season_id;

      // Idempotency: already applied (marker present) ⇒ no-op replay.
      if (await isRatingPeriodApplied(db, round.id)) return;

      // Chronological barrier: defer (throw) if an earlier ranked round in this season is
      // still unapplied, so periods are never applied out of order.
      if (await hasEarlierUnappliedRankedRound(db, seasonId, round.reset_date)) {
        throw new Error(
          `glickoRatingTrigger: round ${round.id} deferred — an earlier ranked round in season ${seasonId} is not yet rated`,
        );
      }

      const standings = await listRateableUniverseStandings(db, round.id);
      const existing = await listSeasonRatings(db, seasonId);
      const stateByAgent = new Map<number, RatingState>(
        existing.map((r) => [
          r.agent_id,
          { rating: r.rating, rd: r.rd, volatility: r.volatility },
        ]),
      );

      const participantIds = new Set<number>();
      const participants: PeriodParticipant[] = [];
      for (const s of standings) {
        // listRateableUniverseStandings guarantees non-null agent_id and final_credits.
        const agentId = s.agent_id!;
        participantIds.add(agentId);
        participants.push({
          agentId,
          finalCredits: s.final_credits!,
          state: stateByAgent.get(agentId) ?? baselineState(config),
        });
      }

      const idle: PeriodIdle[] = existing
        .filter((r) => !participantIds.has(r.agent_id))
        .map((r) => ({
          agentId: r.agent_id,
          state: { rating: r.rating, rd: r.rd, volatility: r.volatility },
        }));

      const results = computeRatingPeriod(participants, idle, config);
      const updates: RatingUpdate[] = results.map((r) => ({
        agentId: r.agentId,
        rating: r.state.rating,
        rd: r.state.rd,
        volatility: r.state.volatility,
      }));

      await applyRatingPeriod(db, { roundId: round.id, seasonId, updates });
    },
  };
}

/** The locked production rating trigger. */
export const glickoRatingTrigger: RatingTrigger = createGlickoRatingTrigger();
