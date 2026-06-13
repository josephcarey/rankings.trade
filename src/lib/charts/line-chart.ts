/**
 * Dependency-free line-chart geometry (Epic J).
 *
 * Produces a fully-resolved, SERIALIZABLE chart model (numbers and strings only)
 * from a set of equal-length numeric series sharing an x-axis. A SvelteKit
 * `load` can build the model server-side and a thin `.svelte` component renders
 * it as inline SVG — no client-only canvas library, so the chart server-renders,
 * needs no hydration, and adds no audit/bundle surface. The data is always also
 * presented in an adjacent table, so the SVG is supplementary and accessible.
 *
 * Design notes:
 *   - The viewBox is a fixed abstract coordinate space; the SVG is scaled
 *     responsively with CSS (`width: 100%`), so callers never pick pixel sizes.
 *   - `null` values are GAPS (a non-participating round), never coerced to zero;
 *     a series is split into contiguous polyline segments around its gaps.
 *   - A lone non-null value (no neighbour to draw a line to) is emitted as a
 *     `dots` point so the component can render a marker.
 *   - Degenerate inputs are handled by the formula, not special cases: no series
 *     or all-null → `hasData: false`; a single x-column or a flat range → points
 *     pinned to the vertical mid-line.
 */

/** One input series: a label and one value (or null gap) per x-column. */
export interface ChartSeriesInput {
  readonly label: string;
  readonly values: readonly (null | number)[];
}

/** A resolved point in viewBox coordinates. */
interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

/** One resolved series ready to render. */
interface ChartSeries {
  /** 0-based index, for deterministic colour assignment in the component. */
  readonly index: number;
  readonly label: string;
  /** Isolated points (a value with no adjacent value to connect to). */
  readonly dots: readonly ChartPoint[];
  /** Contiguous polylines; each is an SVG `points` string ("x,y x,y …"). */
  readonly segments: readonly string[];
}

/** The full serializable chart model. */
export interface ChartModel {
  readonly hasData: boolean;
  readonly height: number;
  readonly series: readonly ChartSeries[];
  /** One label per x-column (e.g. round reset dates). */
  readonly xLabels: readonly string[];
  readonly width: number;
  readonly yMax: number;
  readonly yMin: number;
}

/** Tunable viewBox + inset. */
export interface ChartOptions {
  readonly height?: number;
  /** Inset from each edge so points/strokes are not clipped. */
  readonly padding?: number;
  readonly width?: number;
}

const DEFAULTS = { height: 240, padding: 8, width: 720 } as const;

/** Round to 2dp to keep the serialized SVG compact and deterministic. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build a chart model from equal-length series.
 *
 * @param xLabels - One label per x-column.
 * @param series - Series whose `values` align to `xLabels` (extra/short arrays
 *   are read positionally; missing positions are treated as gaps).
 */
export function buildLineChart(
  xLabels: readonly string[],
  series: readonly ChartSeriesInput[],
  options: ChartOptions = {},
): ChartModel {
  const width = options.width ?? DEFAULTS.width;
  const height = options.height ?? DEFAULTS.height;
  const pad = options.padding ?? DEFAULTS.padding;

  const columns = xLabels.length;
  const allValues = series.flatMap((s) =>
    s.values.filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  const hasData = columns > 0 && allValues.length > 0;

  const yMin = hasData ? Math.min(...allValues) : 0;
  const yMax = hasData ? Math.max(...allValues) : 0;

  const xAt = (i: number): number =>
    columns <= 1 ? width / 2 : pad + (i / (columns - 1)) * (width - 2 * pad);
  const yAt = (value: number): number =>
    yMax === yMin
      ? height / 2
      : height - pad - ((value - yMin) / (yMax - yMin)) * (height - 2 * pad);

  const resolved = series.map((s, index) => {
    const segments: string[] = [];
    const dots: ChartPoint[] = [];
    let run: ChartPoint[] = [];

    const flush = (): void => {
      if (run.length === 1) {
        dots.push(run[0]!);
      } else if (run.length > 1) {
        segments.push(run.map((p) => `${p.x},${p.y}`).join(" "));
      }
      run = [];
    };

    for (let i = 0; i < columns; i++) {
      const value = s.values[i];
      if (value === null || value === undefined || !Number.isFinite(value)) {
        flush();
        continue;
      }
      run.push({ x: round2(xAt(i)), y: round2(yAt(value)) });
    }
    flush();

    return { dots, index, label: s.label, segments };
  });

  return {
    hasData,
    height,
    series: resolved,
    width,
    xLabels,
    yMax,
    yMin,
  };
}
