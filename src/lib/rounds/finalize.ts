/**
 * Round finalization orchestrator (Epic G).
 *
 * Detects ended rounds (a universe reset changed the live `resetDate`) and, for each,
 * freezes the final standings for the Universe and every league, tags the round, and
 * fires the Epic H/I seams — in the brief's order: finalize standings → (if ranked)
 * ratings → (if season-close condition met) season close.
 *
 * Correctness properties (see migrations/0008_rounds.sql and db/rounds.ts):
 *   - IDEMPOTENT & SAFE TO RE-RUN. The final standing of a round is the LAST snapshot
 *     before its reset changed; once a reset is in the past no new snapshots can arrive
 *     for it, so re-computation is deterministic. Standings insert via INSERT OR IGNORE
 *     and the finalize/trigger steps are single-winner conditional updates.
 *   - IMMUTABLE HISTORY. League standings are reconstructed from the membership roster
 *     as of the round's persisted `membership_frozen_at`, so later joins/leaves never
 *     rewrite an archived round.
 *   - NO LOST TRIGGERS. A crash between finalize and a seam is recovered by
 *     {@link finalizePendingRounds}, which re-processes finalized rounds whose
 *     ratings/season markers are still unset.
 *
 * This module owns NO rating or season logic — it only invokes the injected seams.
 */

import type {
  FinalSnapshotRow,
  FrozenMember,
  Round,
  StandingInsert,
} from "../db/rounds";
import type { FinalizationSeams } from "./seams";

import {
  beginFinalization,
  getFinalObservedAt,
  getFirstObservedAt,
  getMembersFrozenAt,
  getOrCreateRound,
  getRoundById,
  getSnapshotRowsAt,
  insertStandings,
  listEndedResetDates,
  listRoundsPendingTriggers,
  markFinalized,
  markRatingsApplied,
  markSeasonProcessed,
} from "../db/rounds";

/** Outcome of finalizing one reset_date. */
export type FinalizeOutcome = "already_finalized" | "finalized" | "no_data";

export interface FinalizeResult {
  outcome: FinalizeOutcome;
  resetDate: string;
  roundId: number;
}

export interface FinalizeSweepSummary {
  /** reset_dates that were already finalized (downstream triggers reconciled). */
  alreadyFinalized: string[];
  /** reset_dates finalized in this sweep. */
  finalized: string[];
  /** ended reset_dates skipped because they had no snapshots to finalize. */
  noData: string[];
  /** count of previously-finalized rounds whose pending triggers were reconciled. */
  pendingProcessed: number;
}

/**
 * Standard competition ranking ("1224"): equal values share a rank and the next rank
 * skips accordingly. `values` must already be sorted into the desired order.
 */
function competitionRanks(values: number[]): number[] {
  const ranks: number[] = [];
  for (const [i, value] of values.entries()) {
    if (i > 0 && value === values[i - 1]) {
      ranks.push(ranks[i - 1]!);
    } else {
      ranks.push(i + 1);
    }
  }
  return ranks;
}

/** Build the Universe standing rows from the final snapshot observation. */
function buildUniverseStandings(
  roundId: number,
  finalRows: FinalSnapshotRow[],
): StandingInsert[] {
  return finalRows.map((row) => ({
    round_id: roundId,
    league_id: null,
    agent_symbol: row.agent_symbol,
    agent_id: row.agent_id,
    final_credits: row.credits,
    final_rank: row.credit_rank ?? 0,
    participated: 1,
  }));
}

/**
 * Build one league's standing rows from its frozen roster and the final snapshot.
 *
 * Members present in the final snapshot are ranked by credits (competition ranking, so
 * equal credits tie — the draw signal Epic H needs); members with no snapshot row are
 * marked `participated = 0` with NULL credits and sorted to the bottom.
 */
function buildLeagueStandings(
  roundId: number,
  leagueId: number,
  members: FrozenMember[],
  creditsBySymbol: Map<string, number | null>,
): StandingInsert[] {
  const present = members
    .filter((m) => creditsBySymbol.has(m.agent_symbol))
    .map((m) => ({ member: m, credits: creditsBySymbol.get(m.agent_symbol) ?? 0 }))
    .sort((a, b) => b.credits - a.credits || a.member.agent_symbol.localeCompare(b.member.agent_symbol));

  const absent = members
    .filter((m) => !creditsBySymbol.has(m.agent_symbol))
    .sort((a, b) => a.agent_symbol.localeCompare(b.agent_symbol));

  const ranks = competitionRanks(present.map((p) => p.credits));
  const absentRank = present.length + 1;

  const rows: StandingInsert[] = present.map((p, i) => ({
    round_id: roundId,
    league_id: leagueId,
    agent_symbol: p.member.agent_symbol,
    agent_id: p.member.agent_id,
    final_credits: p.credits,
    final_rank: ranks[i]!,
    participated: 1,
  }));

  for (const m of absent) {
    rows.push({
      round_id: roundId,
      league_id: leagueId,
      agent_symbol: m.agent_symbol,
      agent_id: m.agent_id,
      final_credits: null,
      final_rank: absentRank,
      participated: 0,
    });
  }

  return rows;
}

/** Group frozen members by their league id, preserving query order. */
function groupByLeague(members: FrozenMember[]): Map<number, FrozenMember[]> {
  const byLeague = new Map<number, FrozenMember[]>();
  for (const m of members) {
    const list = byLeague.get(m.league_id) ?? [];
    list.push(m);
    byLeague.set(m.league_id, list);
  }
  return byLeague;
}

/**
 * Run the Epic H/I trigger seams for a finalized round, once. Ratings (ranked only)
 * run before the season-close evaluation, per the brief's ordering. Each step is gated
 * on its single-winner completion marker so a re-run after a crash is safe and the
 * (idempotent) seams are not required to dedupe on their own.
 */
export async function processRoundTriggers(
  db: D1Database,
  round: Round,
  seams: FinalizationSeams,
): Promise<void> {
  if (round.is_ranked === 1 && round.ratings_applied_at === null) {
    await seams.ratingTrigger.onRankedRoundFinalized(db, round);
    await markRatingsApplied(db, round.id);
  }

  if (round.season_processed_at === null) {
    const close = await seams.seasonCloseEvaluator.shouldCloseSeason(db, round);
    if (close) await seams.seasonCloseTrigger.onSeasonClose(db, round);
    await markSeasonProcessed(db, round.id);
  }
}

/**
 * Finalize a single ended round (keyed by `resetDate`). Idempotent: a fully-finalized
 * round only reconciles its triggers; a round with no snapshots is left untouched.
 */
export async function finalizeRound(
  db: D1Database,
  resetDate: string,
  seams: FinalizationSeams,
): Promise<FinalizeResult> {
  const round = await getOrCreateRound(db, resetDate);

  if (round.finalized_at !== null) {
    await processRoundTriggers(db, round, seams);
    return { outcome: "already_finalized", resetDate, roundId: round.id };
  }

  const finalObservedAt = await getFinalObservedAt(db, resetDate);
  if (finalObservedAt === null) {
    return { outcome: "no_data", resetDate, roundId: round.id };
  }
  const startedAt = await getFirstObservedAt(db, resetDate);

  const { isRanked, seasonId } = await seams.seasonResolver.resolve(db, resetDate);
  if (isRanked && seasonId === null) {
    throw new Error(
      `finalizeRound: season resolver returned a ranked round with no season for ${resetDate}`,
    );
  }

  // Persist immutable inputs + freeze point exactly once; retries re-read the winner's.
  const claimed = await beginFinalization(db, round.id, {
    finalObservedAt,
    startedAt,
    seasonId,
    isRanked,
  });

  const finalRows = await getSnapshotRowsAt(
    db,
    resetDate,
    claimed.final_observed_at!,
  );
  const creditsBySymbol = new Map<string, number | null>(
    finalRows.map((r) => [r.agent_symbol, r.credits]),
  );

  const standings: StandingInsert[] = buildUniverseStandings(round.id, finalRows);

  const members = await getMembersFrozenAt(db, claimed.membership_frozen_at!);
  for (const [leagueId, leagueMembers] of groupByLeague(members)) {
    standings.push(
      ...buildLeagueStandings(round.id, leagueId, leagueMembers, creditsBySymbol),
    );
  }

  await insertStandings(db, standings);
  await markFinalized(db, round.id);

  const finalized = await getRoundById(db, round.id);
  if (!finalized) throw new Error("finalizeRound: round vanished after finalize");
  await processRoundTriggers(db, finalized, seams);

  return { outcome: "finalized", resetDate, roundId: round.id };
}

/**
 * Detect and finalize every round that has ended relative to the live `currentResetDate`,
 * then reconcile any previously-finalized round whose downstream triggers were lost.
 */
export async function finalizePendingRounds(
  db: D1Database,
  currentResetDate: string,
  seams: FinalizationSeams,
): Promise<FinalizeSweepSummary> {
  const ended = await listEndedResetDates(db, currentResetDate);

  const summary: FinalizeSweepSummary = {
    alreadyFinalized: [],
    finalized: [],
    noData: [],
    pendingProcessed: 0,
  };

  for (const resetDate of ended) {
    const result = await finalizeRound(db, resetDate, seams);
    if (result.outcome === "finalized") summary.finalized.push(resetDate);
    else if (result.outcome === "already_finalized") summary.alreadyFinalized.push(resetDate);
    else summary.noData.push(resetDate);
  }

  // Recover triggers lost to a crash between finalize and seam in an earlier sweep.
  for (const round of await listRoundsPendingTriggers(db)) {
    await processRoundTriggers(db, round, seams);
    summary.pendingProcessed += 1;
  }

  return summary;
}
