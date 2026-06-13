/**
 * Read-service composition for the public read API (Epic M).
 *
 * Handlers stay thin: every cross-table read and visibility decision lives here, returning
 * plain view objects the router serialises directly. The module is strictly READ-ONLY — it
 * only ever SELECTs.
 *
 * The governing correctness rule is DEC-I2: ratings are keyed `(agent_id, season_id)` and a
 * closed season's rating rows are RETAINED as history. So every "current" rating/rank/title
 * read is scoped to the OPEN season via {@link getOpenSeason}; with no open season there is no
 * current standing (`current` / `season` are null). Past placements come from the archived
 * `season_standings`, never from the live `ratings` table.
 */

import type { Season } from "../db/seasons";

import { getAgentBySymbol } from "../db/agents";
import {
  getActiveMembership,
  userOwnsActiveMember,
} from "../db/league-members";
import { getLeagueById } from "../db/leagues";
import { getLatestFinalizedLeagueRound, listStandings } from "../db/rounds";
import { getOpenSeason, listAgentSeasonHistory } from "../db/seasons";
import { getLatestSnapshot } from "../db/snapshots";
import { computeSeasonStandings } from "../seasons/standings";
import { paginate, type Pagination } from "./pagination";

/** A compact public view of a season's lifecycle state. */
export type SeasonView = {
  id: number;
  label: string;
  cutoff_date: string;
  unranked_gap_days: number;
  opened_at: string;
  closed_at: string | null;
  unranked_until: string | null;
};

/** One agent's current standing within the OPEN season (DEC-I2 scoped). */
type CurrentStandingView = {
  season_id: number;
  rank: number;
  rating: number;
  rd: number;
  volatility: number;
  title: string | null;
  established: boolean;
  ranked_rounds: number;
};

/** An agent's latest observed Universe credit position. */
type CreditsView = {
  credits: number;
  credit_rank: number;
  total_agents: number;
  reset_date: string;
  observed_at: string;
};

/** One archived past-season placement for an agent. */
type AgentHistoryView = {
  season_id: number;
  label: string;
  closed_at: string | null;
  final_rank: number;
  final_rating: number;
  final_rd: number;
  title: string | null;
  established: boolean;
  ranked_rounds: number;
};

/** The full public agent profile returned by `GET /api/agents/:symbol`. */
export type AgentView = {
  agent: {
    symbol: string;
    display_name: string | null;
    verified: boolean;
  };
  season: SeasonView | null;
  current: CurrentStandingView | null;
  credits: CreditsView | null;
  history: AgentHistoryView[];
};

/** One row of a league's standings. */
type LeagueStandingRow = {
  rank: number;
  agent_symbol: string;
  agent_id: number | null;
  credits: number | null;
  participated: boolean;
};

/** The full view returned by `GET /api/leagues/:id/standings`. */
export type LeagueStandingsView = {
  league: { id: number; name: string; visibility: "private" | "public" };
  round: { id: number; reset_date: string; finalized_at: string | null } | null;
  standings: LeagueStandingRow[];
};

/**
 * The caller's identity for private-league authorization, resolved from an optional bot token.
 * Null when the request is anonymous (or the token was missing/invalid).
 */
export type Viewer = {
  agentId: number;
  ownerUserId: number | null;
} | null;

/** One leaderboard entry within the open season. */
type LeaderboardRow = {
  rank: number;
  agent_id: number;
  rating: number;
  rd: number;
  title: string | null;
  established: boolean;
  ranked_rounds: number;
};

/** A paginated leaderboard page plus the season it was scoped to. */
export type LeaderboardView = {
  season: SeasonView | null;
  items: LeaderboardRow[];
  total: number;
  limit: number;
  offset: number;
};

/** Project a stored season row to its compact public view. */
function toSeasonView(season: Season): SeasonView {
  return {
    id: season.id,
    label: season.label,
    cutoff_date: season.cutoff_date,
    unranked_gap_days: season.unranked_gap_days,
    opened_at: season.opened_at,
    closed_at: season.closed_at,
    unranked_until: season.unranked_until,
  };
}

/**
 * Build the public profile for one agent.
 *
 * Returns null when no agent owns the callsign. Otherwise the agent always 200s: `current` and
 * `season` are the OPEN season's derived standing (null when there is no open season or the
 * agent is unrated in it), `credits` is the latest snapshot (null if never observed), and
 * `history` is the agent's archived past-season placements.
 */
export async function getAgentView(
  db: D1Database,
  symbol: string,
): Promise<AgentView | null> {
  const agent = await getAgentBySymbol(db, symbol);
  if (!agent) return null;

  const openSeason = await getOpenSeason(db);
  let season: SeasonView | null = null;
  let current: CurrentStandingView | null = null;

  if (openSeason) {
    season = toSeasonView(openSeason);
    const standings = await computeSeasonStandings(db, openSeason.id);
    const row = standings.find((s) => s.agent_id === agent.id);
    if (row) {
      current = {
        season_id: openSeason.id,
        rank: row.final_rank,
        rating: row.final_rating,
        rd: row.final_rd,
        volatility: row.final_volatility,
        title: row.title,
        established: row.established,
        ranked_rounds: row.ranked_rounds,
      };
    }
  }

  const snapshot = await getLatestSnapshot(db, agent.symbol);
  const credits: CreditsView | null = snapshot
    ? {
        credits: snapshot.credits,
        credit_rank: snapshot.credit_rank,
        total_agents: snapshot.total_agents,
        reset_date: snapshot.reset_date,
        observed_at: snapshot.observed_at,
      }
    : null;

  const historyRows = await listAgentSeasonHistory(db, agent.id);
  const history = historyRows.map((h) => ({
    season_id: h.season_id,
    label: h.label,
    closed_at: h.closed_at,
    final_rank: h.final_rank,
    final_rating: h.final_rating,
    final_rd: h.final_rd,
    title: h.title,
    established: h.established === 1,
    ranked_rounds: h.ranked_rounds,
  }));

  return {
    agent: {
      symbol: agent.symbol,
      display_name: agent.display_name,
      verified: agent.verified === 1,
    },
    season,
    current,
    credits,
    history,
  };
}

/**
 * Decide whether `viewer` may read a private league's data.
 *
 * Authorized when the viewer's token-resolved agent is an active member, or the viewer's owner
 * owns an active member agent (mirrors Epic E's private-league access). A null owner never
 * grants access. Anonymous viewers are never authorized for a private league.
 */
async function canViewPrivateLeague(
  db: D1Database,
  leagueId: number,
  viewer: Viewer,
): Promise<boolean> {
  if (!viewer) return false;
  if (await getActiveMembership(db, leagueId, viewer.agentId)) return true;
  if (viewer.ownerUserId !== null) {
    return userOwnsActiveMember(db, leagueId, viewer.ownerUserId);
  }
  return false;
}

/**
 * Build a league's standings view, or null when the league does not exist OR the viewer may not
 * see a private league. Collapsing "missing" and "forbidden" into a single null is deliberate:
 * the router maps both to an identical 404, so a private league's existence never leaks (IDOR).
 *
 * The standings are the most recent finalized round's frozen `round_standings` for the league;
 * a league with no finalized rounds yet returns `round: null` and an empty list.
 */
export async function getLeagueStandingsView(
  db: D1Database,
  leagueId: number,
  viewer: Viewer,
): Promise<LeagueStandingsView | null> {
  const league = await getLeagueById(db, leagueId);
  if (!league) return null;

  if (league.visibility === "private") {
    const allowed = await canViewPrivateLeague(db, leagueId, viewer);
    if (!allowed) return null;
  }

  const round = await getLatestFinalizedLeagueRound(db, leagueId);
  const rows = round ? await listStandings(db, round.id, leagueId) : [];

  return {
    league: { id: league.id, name: league.name, visibility: league.visibility },
    round: round
      ? {
          id: round.id,
          reset_date: round.reset_date,
          finalized_at: round.finalized_at,
        }
      : null,
    standings: rows.map((r) => ({
      rank: r.final_rank,
      agent_symbol: r.agent_symbol,
      agent_id: r.agent_id,
      credits: r.final_credits,
      participated: r.participated === 1,
    })),
  };
}

/**
 * Build a paginated Universe leaderboard for the OPEN season (DEC-I2 scoped). The full ranked
 * set is computed once, `total` is taken before slicing, then the requested page is returned.
 * With no open season the page is empty and `season` is null.
 */
export async function getUniverseLeaderboard(
  db: D1Database,
  pagination: Pagination,
): Promise<LeaderboardView> {
  const openSeason = await getOpenSeason(db);
  if (!openSeason) {
    return {
      season: null,
      items: [],
      total: 0,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }

  const standings = await computeSeasonStandings(db, openSeason.id);
  const rows: LeaderboardRow[] = standings.map((s) => ({
    rank: s.final_rank,
    agent_id: s.agent_id,
    rating: s.final_rating,
    rd: s.final_rd,
    title: s.title,
    established: s.established,
    ranked_rounds: s.ranked_rounds,
  }));

  const page = paginate(rows, pagination);
  return {
    season: toSeasonView(openSeason),
    items: page.items,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}

/** The current-season state for `GET /api/seasons/current`. Null when no season is open. */
export async function getCurrentSeasonState(
  db: D1Database,
): Promise<{ season: SeasonView | null }> {
  const openSeason = await getOpenSeason(db);
  return { season: openSeason ? toSeasonView(openSeason) : null };
}
