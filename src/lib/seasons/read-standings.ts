/**
 * Read the OPEN season's standings — cache-first, with a cold-cache fallback (audit §8.1).
 *
 * The READ half of the open-season materialization. Reads prefer the `open_season_standings`
 * cache (a scoped SELECT instead of an O(N) recompute). When the cache is empty for the open
 * season — the window between the 0018 migration running and the next ranked-round finalize
 * re-materializing — these helpers fall back to a fresh {@link computeSeasonStandings} so there
 * is never a stale/empty regression. Once the first round materializes, the fallback stops
 * firing. A genuinely unrated season computes to an empty set either way, so the fallback is a
 * no-op there too.
 *
 * Freshness: a NON-empty cache is always current because the trigger materializes in the same
 * invocation as the rating apply and re-runs on replay until the round is marked applied, and
 * the cron is the single writer — so "cache has rows ⇒ trust it" holds.
 */

import type { OpenStandingPageRow } from "../db/open-standings";
import type { SeasonStandingInsert } from "../db/seasons";
import type { Pagination } from "../read-api/pagination";

import { getSymbolsByIds } from "../db/agents";
import {
  countOpenSeasonStandings,
  openSeasonStandingsExist,
  selectOpenSeasonStanding,
  selectOpenSeasonStandings,
  selectOpenSeasonStandingsPage,
} from "../db/open-standings";
import { computeSeasonStandings } from "./standings";

/** One page of the leaderboard plus the full-field total (for pagination). */
export type OpenStandingsPage = {
  rows: OpenStandingPageRow[];
  total: number;
};

/**
 * The full OPEN-season field in canonical order (rating desc, agent_id asc). Cache-first;
 * falls back to a fresh compute when the cache is cold.
 */
export async function readOpenSeasonStandings(
  db: D1Database,
  seasonId: number,
): Promise<SeasonStandingInsert[]> {
  const cached = await selectOpenSeasonStandings(db, seasonId);
  if (cached.length > 0) return cached;
  return computeSeasonStandings(db, seasonId);
}

/**
 * One agent's OPEN-season standing, or null when the agent is unrated this season. Cache-first;
 * a point-lookup miss is disambiguated with a cheap EXISTS — a warm cache means the agent is
 * simply unrated (null), a cold cache falls back to a fresh compute.
 */
export async function readOpenSeasonStandingForAgent(
  db: D1Database,
  seasonId: number,
  agentId: number,
): Promise<SeasonStandingInsert | null> {
  const row = await selectOpenSeasonStanding(db, seasonId, agentId);
  if (row) return row;
  if (await openSeasonStandingsExist(db, seasonId)) return null;
  const fresh = await computeSeasonStandings(db, seasonId);
  return fresh.find((s) => s.agent_id === agentId) ?? null;
}

/** Shape one fresh-compute standing into the page row (joined symbol). */
function toPageRow(
  standing: SeasonStandingInsert,
  symbol: string,
): OpenStandingPageRow {
  return {
    agent_id: standing.agent_id,
    agent_symbol: symbol,
    final_rating: standing.final_rating,
    final_rd: standing.final_rd,
    final_volatility: standing.final_volatility,
    final_rank: standing.final_rank,
    title: standing.title,
    established: standing.established,
    ranked_rounds: standing.ranked_rounds,
  };
}

/**
 * One page of the OPEN-season leaderboard with the full-field total. The warm path pushes
 * `LIMIT`/`OFFSET`/`COUNT` into SQL; the cold path computes the field once and slices it.
 */
export async function readOpenSeasonLeaderboardPage(
  db: D1Database,
  seasonId: number,
  { limit, offset }: Pagination,
): Promise<OpenStandingsPage> {
  const total = await countOpenSeasonStandings(db, seasonId);
  if (total > 0) {
    const rows = await selectOpenSeasonStandingsPage(db, seasonId, limit, offset);
    return { rows, total };
  }

  // Cold cache: compute the field once, join symbols, paginate in memory.
  const fresh = await computeSeasonStandings(db, seasonId);
  if (fresh.length === 0) return { rows: [], total: 0 };
  const symbols = await getSymbolsByIds(db, fresh.map((s) => s.agent_id));
  const all = fresh.map((s) => toPageRow(s, symbols.get(s.agent_id) ?? "?"));
  return { rows: all.slice(offset, offset + limit), total: all.length };
}
