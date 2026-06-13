<script lang="ts">
  /**
   * Shared inline-SVG line chart (consolidates the former `credits-chart` and
   * `rating-chart`). Server-rendered from the dependency-free chart geometry
   * (`src/lib/charts/line-chart.ts`) — no client charting library, no hydration.
   *
   * `legend` toggles the per-series swatch legend (multi-series credits show it;
   * a single-series rating does not). Colours come from a tokenised palette
   * assigned by series index, so every series is styled consistently.
   *
   * Accessibility: the SVG carries an in-document `<title>`/`<desc>` referenced
   * via `aria-labelledby`/`aria-describedby`, and a visually-hidden text summary
   * gives assistive tech a non-visual alternative to the line geometry.
   */
  import type { ChartModel } from "../charts/line-chart";

  let {
    caption,
    chart,
    emptyText = "No history yet.",
    legend = false,
  }: {
    caption?: string;
    chart: ChartModel;
    emptyText?: string;
    legend?: boolean;
  } = $props();

  const titleText = $derived(caption ?? "Line chart");

  const uid = $props.id();
  const titleId = `chart-title-${uid}`;
  const descId = `chart-desc-${uid}`;

  // Deterministic palette assigned by series index (presentation only).
  const PALETTE = [
    "#2563eb",
    "#dc2626",
    "#059669",
    "#d97706",
    "#7c3aed",
    "#0891b2",
    "#be185d",
    "#65a30d",
    "#4b5563",
    "#c026d3",
  ];

  const color = (index: number): string => PALETTE[index % PALETTE.length]!;

  const seriesNames = $derived(chart.series.map((s) => s.label).join(", "));
  const span = $derived(
    chart.xLabels.length > 0
      ? `${chart.xLabels[0]} to ${chart.xLabels.at(-1)}`
      : "no data points",
  );
  const descText = $derived(
    `${titleText}. ${chart.series.length} series (${seriesNames}) across ` +
      `${chart.xLabels.length} points, ${span}. ` +
      `Values range from ${Math.round(chart.yMin)} to ${Math.round(chart.yMax)}.`,
  );
</script>

{#if chart.hasData}
  <figure class="chart">
    <svg
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <title id={titleId}>{titleText}</title>
      <desc id={descId}>{descText}</desc>
      {#each chart.series as series (series.index)}
        {#each series.segments as points, segmentIndex (segmentIndex)}
          <polyline
            {points}
            fill="none"
            stroke={color(series.index)}
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
        {/each}
        {#each series.dots as dot, dotIndex (dotIndex)}
          <circle cx={dot.x} cy={dot.y} r="2.5" fill={color(series.index)} />
        {/each}
      {/each}
    </svg>
    {#if legend}
      <figcaption class="legend">
        {#each chart.series as series (series.index)}
          <span class="legend-item">
            <span class="swatch" style={`background:${color(series.index)}`}></span>
            {series.label}
          </span>
        {/each}
      </figcaption>
    {/if}
  </figure>
{:else}
  <p class="empty">{emptyText}</p>
{/if}

<style>
  .chart {
    margin: 0;
  }

  svg {
    inline-size: 100%;
    block-size: auto;
    aspect-ratio: 3 / 1;
    background: var(--color-surface);
    border-radius: var(--radius-2);
  }

  /* Taller chart on narrow screens so the trend stays legible (§4.2). */
  @media (max-width: 480px) {
    svg {
      aspect-ratio: 2 / 1;
    }
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-3);
    margin-block-start: var(--size-2);
    font-size: var(--font-size-0);
    color: var(--color-text-muted);
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: var(--size-1);
    font-family: var(--font-mono, monospace);
  }

  .swatch {
    inline-size: 0.75rem;
    block-size: 0.75rem;
    border-radius: var(--radius-1);
  }
</style>
