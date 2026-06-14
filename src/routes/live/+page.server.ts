import type { PageServerLoad } from "./$types";

import { buildLineChart } from "../../lib/charts/line-chart";
import {
  getCurrentSnapshotResetDate,
  listCurrentSnapshotSeries,
  listCurrentUniverseSnapshotRanking,
} from "../../lib/db/snapshot-rankings";

/** How many top-ranked agents the live credits graph plots. */
const GRAPH_TOP_N = 10;

/**
 * Public live view (pre-finalize). The current cycle's full ranking taken from
 * the LATEST snapshot bucket per agent, plus a credits graph of the top agents
 * over the cycle's snapshot history. Reads `snapshots` directly so it works
 * BEFORE any round finalizes — unlike the finalize-gated leaderboard.
 */
export const load: PageServerLoad = async ({ platform }) => {
  const db = platform?.env.DB;
  if (!db) return { chart: null, resetDate: null, rows: [] };

  const resetDate = await getCurrentSnapshotResetDate(db);
  const rows = await listCurrentUniverseSnapshotRanking(db);

  const topSymbols = rows.slice(0, GRAPH_TOP_N).map((row) => row.symbol);
  const series = await listCurrentSnapshotSeries(db, resetDate, topSymbols);
  const chart = buildLineChart(
    series.observedAts,
    topSymbols.map((symbol) => ({
      label: symbol,
      values: series.bySymbol.get(symbol) ?? [],
    })),
  );

  return { chart, resetDate, rows };
};
