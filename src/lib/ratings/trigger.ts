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
 *
 * After the rating period is applied, it MATERIALIZES the open season's standings cache (audit
 * §8.1) from the just-updated ratings, so the read paths SELECT instead of recomputing. The
 * cache write rides the SAME finalize step but a SEPARATE atomic batch, so it is replay-safe:
 * it re-runs even when the period is already applied (healing a crash between the rating apply
 * and this write, since `rounds.ratings_applied_at` is only set AFTER this returns), and is
 * skipped once the season is closed (a closed season's standings live in `season_standings`).
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
  type RatingHistoryInsert,
  type RatingUpdate,
} from "../db/ratings";
import { listRateableUniverseStandings } from "../db/rounds";
import { getOpenSeason } from "../db/seasons";
import { materializeOpenSeasonStandings } from "../seasons/materialize";
import { baselineState, GLICKO2_CONFIG } from "./config";
import { rankByRatingDesc } from "./rank";
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

      // Idempotency: skip the rating apply when the period's marker is already present, but
      // STILL fall through to (re)materialize the cache below — the cache write is a separate
      // batch, so a replay after a crash between the apply and this point heals it.
      if (!(await isRatingPeriodApplied(db, round.id))) {
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

        // `results` is the FULL post-period season population (participants ∪ idle), so it
        // equals what the leaderboard ranks. Rank over it with the SHARED competition-ranking
        // helper (Epic I uses the same one) so each agent's stored history rank for this round
        // is identical to its live leaderboard rank — what makes the rank deltas exact.
        const ranks = rankByRatingDesc(
          results.map((r) => ({ agentId: r.agentId, rating: r.state.rating })),
        );
        const history: RatingHistoryInsert[] = results.map((r) => ({
          agentId: r.agentId,
          rating: r.state.rating,
          rd: r.state.rd,
          rank: ranks.get(r.agentId)!,
        }));

        await applyRatingPeriod(db, {
          roundId: round.id,
          seasonId,
          updates,
          history,
        });
      }

      // Materialize the open-season standings cache from the just-applied ratings (audit §8.1),
      // but only while the season is still OPEN (a closed season's standings are the immutable
      // `season_standings` archive — DEC-I2). Reuses `computeSeasonStandings`, so the cache is
      // identical to a fresh compute by construction. Throws on failure so the orchestrator
      // withholds `ratings_applied_at` and the pending-sweep retries.
      const openSeason = await getOpenSeason(db);
      if (openSeason?.id === seasonId) {
        await materializeOpenSeasonStandings(db, seasonId, round.id);
      }
    },
  };
}

/** The locked production rating trigger. */
export const glickoRatingTrigger: RatingTrigger = createGlickoRatingTrigger();
