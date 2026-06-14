<script lang="ts">
  import LineChart from "../../lib/components/line-chart.svelte";

  let { data } = $props();

  const fmt = (value: null | number): string =>
    value === null ? "—" : value.toLocaleString("en-US");
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

  {#if data.rows.length === 0}
    <p class="empty">
      No snapshots have been captured yet. Live standings appear once the scraper records the
      first observation of the cycle.
    </p>
  {:else}
    {#if data.chart}
      <section class="graph flow">
        <h2>Top agents — credits this cycle</h2>
        <LineChart
          chart={data.chart}
          caption="Credits of the top agents over the current cycle"
          emptyText="No credits history yet."
          legend
        />
      </section>
    {/if}

    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col" class="num">#</th>
            <th scope="col">Agent</th>
            <th scope="col" class="num">Credits</th>
            <th scope="col" class="num optional-col">Credit rank</th>
            <th scope="col" class="num optional-col">Ships</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (row.symbol)}
            <tr>
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

  .footnote {
    font-size: var(--font-size-0);
  }
</style>
