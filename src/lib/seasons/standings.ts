/**
 * Season standings computation (Epic I) — composes the live `ratings` state with the title
 * ladder into the per-agent final standing rows.
 *
 * Used in two places:
 *   - the season-close trigger archives the result into `season_standings`;
 *   - read paths (Epic J / API) can call {@link computeSeasonStandings} to render the CURRENT
 *     title/rank of an in-progress season from its live ratings.
 *
 * Ranking is standard competition ranking (1224) over ALL rated agents by rating descending —
 * ties share a rank. Titles come from {@link computeTitles}, which applies the established
 * floor and the percentile/threshold ladder over the established sub-population only.
 */

import type { SeasonStandingInsert } from "../db/seasons";
import type { TitleInput } from "../titles/compute";
import type { TitleConfig } from "../titles/config";

import { listSeasonRatings } from "../db/ratings";
import { countRankedRoundsByAgent } from "../db/seasons";
import { computeTitles } from "../titles/compute";
import { TITLE_CONFIG } from "../titles/config";

/**
 * Standard competition ranking ("1224") for ratings sorted descending: equal ratings share a
 * rank and the next rank skips accordingly.
 */
function competitionRanks(sortedDesc: readonly number[]): number[] {
  const ranks: number[] = [];
  for (const [i, value] of sortedDesc.entries()) {
    ranks.push(i > 0 && value === sortedDesc[i - 1] ? ranks[i - 1]! : i + 1);
  }
  return ranks;
}

/**
 * Build the final-standing rows for a season from its current ratings.
 *
 * @returns one row per rated agent, ranked by rating desc, with the derived title (null when
 *   the agent is not established). Empty when the season has no ratings yet.
 */
export async function computeSeasonStandings(
  db: D1Database,
  seasonId: number,
  config: TitleConfig = TITLE_CONFIG,
): Promise<SeasonStandingInsert[]> {
  const ratings = await listSeasonRatings(db, seasonId);
  if (ratings.length === 0) return [];

  const rankedRounds = await countRankedRoundsByAgent(db, seasonId);

  const titleInputs: TitleInput[] = ratings.map((r) => ({
    agentId: r.agent_id,
    rating: r.rating,
    rd: r.rd,
    rankedRounds: rankedRounds.get(r.agent_id) ?? 0,
  }));
  const titles = new Map(
    computeTitles(titleInputs, config).map((t) => [t.agentId, t]),
  );

  // Rank by rating desc; ties broken by agent_id for a deterministic order before ranking.
  const sorted = [...ratings].toSorted(
    (a, b) => b.rating - a.rating || a.agent_id - b.agent_id,
  );
  const ranks = competitionRanks(sorted.map((r) => r.rating));

  return sorted.map((r, i) => {
    const title = titles.get(r.agent_id);
    return {
      season_id: seasonId,
      agent_id: r.agent_id,
      final_rating: r.rating,
      final_rd: r.rd,
      final_volatility: r.volatility,
      final_rank: ranks[i]!,
      title: title?.title ?? null,
      established: title?.established ?? false,
      ranked_rounds: rankedRounds.get(r.agent_id) ?? 0,
    };
  });
}
