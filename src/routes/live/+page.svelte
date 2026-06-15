<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";

  import { buildLineChart } from "../../lib/charts/line-chart";
  import LineChart from "../../lib/components/line-chart.svelte";

  let { data } = $props();

  const fmt = (value: null | number): string =>
    value === null ? "—" : value.toLocaleString("en-US");

  // Normalize the payload once. A short CDN/browser cache can serve a STALE
  // `/live/__data.json` (a pre-line-picker shape with no observedAts/series) to
  // a client already running the new bundle, so these fields may be missing on a
  // transient post-deploy cache skew. Default them here and read the locals
  // everywhere so a partial payload renders the empty state instead of throwing.
  const observedAts = $derived(data.observedAts ?? []);
  const rows = $derived(data.rows ?? []);
  const seriesBySymbol = $derived(data.seriesBySymbol ?? {});

  // Which agent lines are plotted. Seeded with the server's default top-10 so
  // first paint matches the SSR chart exactly; toggling is a pure client-side
  // recompute of `buildLineChart` over the shipped series matrix.
  const selected = new SvelteSet<string>(data.defaultSymbols ?? []);

  // Client-side filter to find an agent among the full list (e.g. a mid-pack
  // callsign) without scrolling — purely narrows the visible rows.
  let filter = $state("");

  const hasSeries = $derived(observedAts.length > 0);

  const normalizedFilter = $derived(filter.trim().toUpperCase());
  const visibleRows = $derived(
    normalizedFilter === ""
      ? rows
      : rows.filter((row) => row.symbol.toUpperCase().includes(normalizedFilter)),
  );

  // Build the chart from the SELECTED rows in rank order (stable, deterministic
  // colour assignment). buildLineChart recomputes yMin/yMax from this subset, so
  // the y-axis rescales to fit exactly the currently-plotted lines.
  const selectedChart = $derived(
    buildLineChart(
      observedAts,
      rows
        .filter((row) => selected.has(row.symbol))
        .map((row) => ({
          label: row.symbol,
          values: seriesBySymbol[row.symbol] ?? [],
        })),
    ),
  );

  function toggle(symbol: string): void {
    if (selected.has(symbol)) selected.delete(symbol);
    else selected.add(symbol);
  }

  function selectAll(): void {
    for (const row of rows) selected.add(row.symbol);
  }

  function selectNone(): void {
    selected.clear();
  }
</script>

<svelte:head>
  <title>Live standings · rankings.trade</title>
  <meta
    name="description"
    content="Live SpaceTraders Universe standings from the latest snapshot of the current cycle."
  />
</svelte:head>

<section class="live flow wrapper">
  <header class="head">
    <p class="eyebrow">Universe</p>
    <h1>Live standings</h1>
    {#if data.resetDate}
      <p class="lede">
        Current cycle: <strong>{data.resetDate}</strong> · updated every 15 minutes from the
        latest snapshot. These are live credits, before the round is finalized.
      </p>
    {/if}
  </header>

  {#if rows.length === 0}
    <p class="empty">
      No snapshots have been captured yet. Live standings appear once the scraper records the
      first observation of the cycle.
    </p>
  {:else}
    {#if hasSeries}
      <section class="graph flow">
        <h2>Top agents — credits this cycle</h2>
        <LineChart
          chart={selectedChart}
          caption="Credits of the selected agents over the current cycle"
          emptyText="No agents selected — tick a row below to plot its credit line."
          legend
        />
        <div class="chart-controls">
          <div class="control-buttons">
            <button type="button" onclick={selectAll}>All</button>
            <button type="button" onclick={selectNone}>None</button>
          </div>
          <p class="selection-count" aria-live="polite">
            Plotting <strong>{selected.size}</strong> of {rows.length} agents.
            {#if selected.size > 40}
              <span class="hint">Lots of lines — deselect some for a clearer comparison.</span>
            {/if}
          </p>
        </div>
        <div class="filter">
          <label for="agent-filter">Find an agent</label>
          <input
            id="agent-filter"
            type="search"
            bind:value={filter}
            placeholder="Filter by callsign…"
            autocomplete="off"
          />
        </div>
      </section>
    {/if}

    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            {#if hasSeries}
              <th scope="col" class="pick-col">Line</th>
            {/if}
            <th scope="col" class="num">#</th>
            <th scope="col">Agent</th>
            <th scope="col" class="num">Credits</th>
            <th scope="col" class="num optional-col">Credit rank</th>
            <th scope="col" class="num optional-col">Ships</th>
          </tr>
        </thead>
        <tbody>
          {#each visibleRows as row (row.symbol)}
            <tr>
              {#if hasSeries}
                <td class="pick-col">
                  <input
                    type="checkbox"
                    checked={selected.has(row.symbol)}
                    onchange={() => toggle(row.symbol)}
                    aria-label={`Plot ${row.symbol} credit line`}
                  />
                </td>
              {/if}
              <td class="num">{row.rank}</td>
              <td>
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic public profile route -->
                <a class="callsign" href={`/u/${row.symbol}`}>{row.symbol}</a>
              </td>
              <td class="num">{fmt(row.credits)}</td>
              <td class="num optional-col">{fmt(row.credit_rank)}</td>
              <td class="num optional-col">{fmt(row.ship_count)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="footnote empty">
      Live credits from the latest snapshot of the current cycle. Ranked ratings and titles
      appear on the <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public content route --><a
        href="/leaderboard">leaderboard</a
      > once a round finalizes.
    </p>
  {/if}
</section>

<style>
  .live {
    padding-block: var(--size-8);
    max-inline-size: 60rem;
  }

  h1 {
    font-size: var(--font-size-fluid-2);
    margin: 0;
  }

  .lede {
    color: var(--color-text-muted);
  }

  .graph {
    margin-block: var(--size-5);
  }

  .chart-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-3);
    margin-block-start: var(--size-3);
  }

  .control-buttons {
    display: flex;
    gap: var(--size-2);
  }

  .control-buttons button {
    padding: var(--size-1) var(--size-3);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-2);
    cursor: pointer;
  }

  .control-buttons button:hover {
    border-color: var(--color-text-muted);
  }

  .selection-count {
    margin: 0;
    font-size: var(--font-size-0);
    color: var(--color-text-muted);
  }

  .selection-count .hint {
    font-style: italic;
  }

  .filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-2);
    margin-block-start: var(--size-3);
    font-size: var(--font-size-0);
  }

  .filter input {
    flex: 1 1 12rem;
    min-inline-size: 8rem;
    padding: var(--size-1) var(--size-2);
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-2);
  }

  .pick-col {
    inline-size: 1px;
    white-space: nowrap;
    text-align: center;
  }

  .pick-col input {
    cursor: pointer;
  }

  .footnote {
    font-size: var(--font-size-0);
  }
</style>
