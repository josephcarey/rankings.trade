<script lang="ts">
  /**
   * A compact promotion/demotion indicator (Epic O). `delta` is positive when the agent
   * improved (rating went up, or rank moved toward #1), negative when it dropped, 0 when
   * unchanged, and null when there is no previous ranked round (a new entrant) — in which
   * case nothing is rendered, never a fake ▲0.
   */
  let {
    delta,
    label,
  }: { delta: null | number; label: string } = $props();

  const direction = $derived(
    delta === null || delta === 0 ? "flat" : (delta > 0 ? "up" : "down"),
  );
  const arrow = $derived(direction === "up" ? "▲" : (direction === "down" ? "▼" : "▬"));
  const magnitude = $derived(delta === null ? 0 : Math.abs(delta));
</script>

{#if delta !== null}
  <span
    class="delta delta-{direction}"
    title={`${label}: ${delta > 0 ? "+" : (delta < 0 ? "−" : "±")}${magnitude} since the previous round`}
  >
    <span aria-hidden="true">{arrow}</span>
    {#if magnitude > 0}<span class="mag">{magnitude}</span>{/if}
    <span class="sr-only">
      {label}
      {direction === "up" ? "up" : (direction === "down" ? "down" : "unchanged")}
      {magnitude > 0 ? magnitude : ""} since the previous round
    </span>
  </span>
{:else}
  <span class="delta delta-new" title={`${label}: new this season`}>
    <span aria-hidden="true">·</span>
    <span class="sr-only">{label}: new this season</span>
  </span>
{/if}

<style>
  .delta {
    display: inline-flex;
    align-items: baseline;
    gap: 0.15em;
    font-size: var(--font-size-0);
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-weight-7);
  }

  .delta-up {
    color: var(--color-up, #059669);
  }

  .delta-down {
    color: var(--color-down, #dc2626);
  }

  .delta-flat,
  .delta-new {
    color: var(--color-text-muted);
  }

  .sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
