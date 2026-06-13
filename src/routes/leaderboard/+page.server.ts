import type { PageServerLoad } from "./$types";

import { buildLineChart } from "../../lib/charts/line-chart";
import { listUniverseCreditsSeries } from "../../lib/db/credits";
import { buildLeaderboard } from "../../lib/db/leaderboard";
import { listSeasonRoundDeltas } from "../../lib/db/rating-history";
import { getOpenSeason } from "../../lib/db/seasons";

/** How many top-ranked agents the credits graph plots. */
const GRAPH_TOP_N = 8;

/**
 * Global Universe leaderboard, scoped to the OPEN season (DEC-I2): the full
 * ranked table (rank, callsign, rating, title) plus a credits graph of the
 * top-ranked agents across the season's finalized rounds.
 *
 * When no season is open (e.g. an unranked gap) there is no current ranked
 * rating to show, so the page renders an explicit empty state rather than any
 * retained closed-season ratings.
 */
export const load: PageServerLoad = async ({ platform }) => {
  const db = platform?.env.DB;
  if (!db) return { chart: null, rows: [], season: null };

  const season = await getOpenSeason(db);
  if (!season) return { chart: null, rows: [], season: null };

  const rows = await buildLeaderboard(db, season.id);
  const deltas = await listSeasonRoundDeltas(db, season.id);
  const rowsWithDelta = rows.map((row) => ({
    ...row,
    rankDelta: deltas.get(row.agentId)?.rankDelta ?? null,
  }));
  const topIds = rows.slice(0, GRAPH_TOP_N).map((row) => row.agentId);
  const series = await listUniverseCreditsSeries(db, season.id, topIds);

  const symbolById = new Map(rows.map((row) => [row.agentId, row.symbol]));
  const chart = buildLineChart(
    series.rounds.map((round) => round.reset_date),
    topIds.map((id) => ({
      label: symbolById.get(id) ?? "?",
      values: series.byAgent.get(id) ?? [],
    })),
  );

  return { chart, rows: rowsWithDelta, season: { label: season.label } };
};
