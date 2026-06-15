import type { PageServerLoad } from "./$types";

import { buildLineChart } from "../../lib/charts/line-chart";
import {
  getCurrentSnapshotResetDate,
  listCurrentSnapshotSeriesMatrix,
  listCurrentUniverseSnapshotRanking,
} from "../../lib/db/snapshot-rankings";

/** How many top-ranked agents the live credits graph plots by default. */
const GRAPH_TOP_N = 10;

/**
 * Public live view (pre-finalize). The current cycle's full ranking taken from
 * the LATEST snapshot bucket per agent, plus a credits graph of the top agents
 * over the cycle's snapshot history. Reads `snapshots` directly so it works
 * BEFORE any round finalizes — unlike the finalize-gated leaderboard.
 *
 * Ships a DOWNSAMPLED credit-series matrix for every agent so the client can let
 * users toggle which lines appear and recompute the chart (incl. y-axis rescale)
 * without a per-agent round-trip. The default top-10 chart is also built
 * server-side from that same matrix, so the page renders identically with or
 * without JS and there is no hydration flash.
 */
export const load: PageServerLoad = async ({ platform, setHeaders }) => {
  const db = platform?.env.DB;
  if (!db) {
    return {
      chart: null,
      defaultSymbols: [] as string[],
      observedAts: [] as string[],
      resetDate: null,
      rows: [],
      seriesBySymbol: {} as Record<string, (null | number)[]>,
    };
  }

  // Public launch page running a ~190k-row aggregation per request, fed by a
  // 15-minute scraper — a short cache shields the DB from request spikes while
  // keeping the view fresh within one snapshot interval.
  setHeaders({ "cache-control": "public, max-age=30, s-maxage=60" });

  const resetDate = await getCurrentSnapshotResetDate(db);
  const rows = await listCurrentUniverseSnapshotRanking(db);
  const matrix = await listCurrentSnapshotSeriesMatrix(db, resetDate);

  const defaultSymbols = rows.slice(0, GRAPH_TOP_N).map((row) => row.symbol);
  const seriesBySymbol: Record<string, (null | number)[]> = Object.fromEntries(
    matrix.bySymbol,
  );
  const chart = buildLineChart(
    matrix.observedAts,
    defaultSymbols.map((symbol) => ({
      label: symbol,
      values: seriesBySymbol[symbol] ?? [],
    })),
  );

  return {
    chart,
    defaultSymbols,
    observedAts: matrix.observedAts,
    resetDate,
    rows,
    seriesBySymbol,
  };
};
