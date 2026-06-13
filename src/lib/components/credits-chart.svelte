<script lang="ts">
  import type { ChartModel } from "../charts/line-chart";

  let {
    caption,
    chart,
  }: { caption?: string; chart: ChartModel } = $props();

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
</script>

{#if chart.hasData}
  <figure class="chart">
    <svg
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={caption ?? "Credits over time"}
    >
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
    <figcaption class="legend">
      {#each chart.series as series (series.index)}
        <span class="legend-item">
          <span class="swatch" style={`background:${color(series.index)}`}></span>
          {series.label}
        </span>
      {/each}
    </figcaption>
  </figure>
{:else}
  <p class="empty">No credits history yet.</p>
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

  .empty {
    color: var(--color-text-muted);
  }
</style>
