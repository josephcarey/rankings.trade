<script lang="ts">
  /**
   * Rating-over-time line chart (Epic O). A thin wrapper over the dependency-free chart
   * geometry (src/lib/charts/line-chart.ts) — the SAME inline-SVG approach as
   * `credits-chart.svelte`, server-rendered with no charting dependency. The data is also
   * presented as an adjacent table on the page, so the SVG is supplementary and accessible.
   */
  import type { ChartModel } from "../charts/line-chart";

  let {
    caption,
    chart,
  }: { caption?: string; chart: ChartModel } = $props();

  const STROKE = "#7c3aed";
</script>

{#if chart.hasData}
  <figure class="chart">
    <svg
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={caption ?? "Rating over time"}
    >
      {#each chart.series as series (series.index)}
        {#each series.segments as points, segmentIndex (segmentIndex)}
          <polyline
            {points}
            fill="none"
            stroke={STROKE}
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
        {/each}
        {#each series.dots as dot, dotIndex (dotIndex)}
          <circle cx={dot.x} cy={dot.y} r="2.5" fill={STROKE} />
        {/each}
      {/each}
    </svg>
  </figure>
{:else}
  <p class="empty">No rating history yet.</p>
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

  .empty {
    color: var(--color-text-muted);
  }
</style>
