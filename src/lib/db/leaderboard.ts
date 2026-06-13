/**
 * Universe leaderboard composition (Epic J) — read-only.
 *
 * Joins the OPEN-season standings (the materialized `open_season_standings` cache,
 * which mirrors `computeSeasonStandings` — rank + title derived from the live
 * `(agent_id, season_id)` ratings, DEC-I2) with agent callsigns into render-ready
 * rows. Callers MUST resolve the open season via `getOpenSeason` first; this module
 * never reads closed-season ratings.
 */

import type { SeasonStandingInsert } from "./seasons";

import { readOpenSeasonStandings } from "../seasons/read-standings";
import { getSymbolsByIds } from "./agents";

/** One render-ready leaderboard / current-standing row. */
export interface LeaderboardRow {
  readonly agentId: number;
  readonly established: boolean;
  readonly rank: number;
  readonly rankedRounds: number;
  readonly rating: number;
  readonly rd: number;
  readonly symbol: string;
  readonly title: null | string;
}

/** Shape one season standing + its symbol into a {@link LeaderboardRow}. */
export function toLeaderboardRow(
  standing: SeasonStandingInsert,
  symbol: string,
): LeaderboardRow {
  return {
    agentId: standing.agent_id,
    established: standing.established,
    rank: standing.final_rank,
    rankedRounds: standing.ranked_rounds,
    rating: standing.final_rating,
    rd: standing.final_rd,
    symbol,
    title: standing.title,
  };
}

/**
 * The full open-season Universe leaderboard, ranked by rating (competition
 * ranking; ties share a rank). Empty when the season has no rated agents yet.
 * Reads the materialized `open_season_standings` cache (audit §8.1), falling back
 * to a fresh compute only while the cache is cold.
 */
export async function buildLeaderboard(
  db: D1Database,
  seasonId: number,
): Promise<LeaderboardRow[]> {
  const standings = await readOpenSeasonStandings(db, seasonId);
  if (standings.length === 0) return [];

  const symbols = await getSymbolsByIds(
    db,
    standings.map((s) => s.agent_id),
  );
  return standings.map((s) => toLeaderboardRow(s, symbols.get(s.agent_id) ?? "?"));
}
