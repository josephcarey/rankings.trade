import { error } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

import { buildLineChart } from "../../../lib/charts/line-chart";
import { getAgentBySymbol, normalizeSymbol } from "../../../lib/db/agents";
import { listUniverseCreditsSeries } from "../../../lib/db/credits";
import { toLeaderboardRow } from "../../../lib/db/leaderboard";
import { listActiveLeaguesForAgent } from "../../../lib/db/leagues";
import { listLogsByAgent } from "../../../lib/db/logs";
import { recognizedTypesForAgent } from "../../../lib/db/milestone-types";
import { listMilestonesByAgent } from "../../../lib/db/milestones";
import {
  getAgentRatingDelta,
  listAgentRatingHistory,
} from "../../../lib/db/rating-history";
import { getOpenSeason, listAgentSeasonHistory } from "../../../lib/db/seasons";
import { resolveActor } from "../../../lib/leagues/actor";
import { getViewableLeague } from "../../../lib/leagues/league-service";
import { describeMilestone } from "../../../lib/render/milestone";
import { computeSeasonStandings } from "../../../lib/seasons/standings";

/**
 * Public agent profile (`/u/[symbol]`).
 *
 * Visibility & correctness:
 *   - "Current" title/rank/rating is scoped to the OPEN season (DEC-I2) via
 *     `getOpenSeason` + `computeSeasonStandings`; with no open season we show no
 *     current rating (never a retained closed-season one).
 *   - Season HISTORY comes from the archived `season_standings`.
 *   - Leagues are filtered to those the viewer may see (`getViewableLeague`), so
 *     a private league is never revealed; milestone recognition is likewise
 *     restricted to the viewer-visible leagues, so a private league's curated
 *     custom-type labels never leak to the public.
 *   - The "manage" dashboard link is gated on real ownership, server-side.
 */
export const load: PageServerLoad = async ({ locals, params, platform }) => {
  const db = platform?.env.DB;
  if (!db) error(500, "Profiles are unavailable.");

  const symbol = normalizeSymbol(params.symbol);
  const agent = await getAgentBySymbol(db, symbol);
  if (!agent) error(404, "Agent not found.");

  const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});

  // Current open-season standing + this-season credits graph (DEC-I2).
  const season = await getOpenSeason(db);
  let current = null;
  let chart = buildLineChart([], []);
  let ratingChart = buildLineChart([], []);
  let delta = null;
  if (season) {
    const standings = await computeSeasonStandings(db, season.id);
    const row = standings.find((s) => s.agent_id === agent.id);
    current = row ? toLeaderboardRow(row, agent.symbol) : null;
    const series = await listUniverseCreditsSeries(db, season.id, [agent.id]);
    chart = buildLineChart(
      series.rounds.map((r) => r.reset_date),
      [{ label: agent.symbol, values: series.byAgent.get(agent.id) ?? [] }],
    );

    // Rating-over-time (Epic O): the agent's per-round Glicko-2 line for the open season,
    // plus the rank/rating delta since the previous ranked round.
    const ratingPoints = await listAgentRatingHistory(db, agent.id, season.id);
    ratingChart = buildLineChart(
      ratingPoints.map((p) => p.resetDate),
      [{ label: agent.symbol, values: ratingPoints.map((p) => p.rating) }],
    );
    delta = await getAgentRatingDelta(db, agent.id, season.id);
  }

  // Leagues this agent is in, filtered to what the viewer may see.
  const active = await listActiveLeaguesForAgent(db, agent.id);
  const leagues: { id: number; name: string; visibility: string }[] = [];
  for (const league of active) {
    const viewable = await getViewableLeague(db, actor, league.id);
    if (viewable.ok) {
      leagues.push({
        id: league.id,
        name: league.name,
        visibility: league.visibility,
      });
    }
  }
  const visibleLeagueIds = leagues.map((l) => l.id);

  // Milestones + logs (recognition restricted to viewer-visible leagues).
  const recognized = await recognizedTypesForAgent(db, agent.id, visibleLeagueIds);
  const milestoneRecords = await listMilestonesByAgent(db, agent.id);
  const milestones = milestoneRecords.map((m) => describeMilestone(m, recognized));
  const logRecords = await listLogsByAgent(db, agent.id);
  const logs = logRecords.map((l) => ({
    text: l.text,
    ts: l.ts,
  }));

  // Archived season history.
  const historyRecords = await listAgentSeasonHistory(db, agent.id);
  const history = historyRecords.map((h) => ({
    closed: h.closed_at !== null,
    rank: h.final_rank,
    rankedRounds: h.ranked_rounds,
    rating: h.final_rating,
    seasonLabel: h.label,
    title: h.title,
  }));

  return {
    agent: { symbol: agent.symbol, verified: agent.verified },
    canManage: actor !== null && agent.owner_user_id === actor.userId,
    chart,
    current,
    delta,
    history,
    leagues,
    logs,
    milestones,
    ratingChart,
    seasonLabel: season?.label ?? null,
  };
};
