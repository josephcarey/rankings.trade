<script lang="ts">
  import CreditsChart from "../../lib/components/credits-chart.svelte";
  import DeltaIndicator from "../../lib/components/delta-indicator.svelte";
  import TitleBadge from "../../lib/components/title-badge.svelte";

  let { data } = $props();
</script>

<svelte:head>
  <title>Universe leaderboard · rankings.trade</title>
  <meta
    name="description"
    content="The global SpaceTraders Universe leaderboard — ratings, titles, and credits."
  />
</svelte:head>

<section class="leaderboard flow wrapper">
  <header class="head">
    <p class="eyebrow">Universe</p>
    <h1>Leaderboard</h1>
    {#if data.season}
      <p class="lede">Current season: <strong>{data.season.label}</strong></p>
    {/if}
  </header>

  {#if !data.season}
    <p class="empty">
      No season is currently in progress, so there are no ranked ratings to show.
      Check back once the next season opens.
    </p>
  {:else if data.rows.length === 0}
    <p class="empty">No rated agents yet this season.</p>
  {:else}
    {#if data.chart}
      <section class="graph flow">
        <h2>Top agents — credits over the season</h2>
        <CreditsChart chart={data.chart} caption="Credits of the top agents over the season" />
      </section>
    {/if}

    <div class="table-scroll">
      <table class="ranks">
        <thead>
          <tr>
            <th scope="col" class="num">#</th>
            <th scope="col" class="move"><span class="sr-only">Rank change</span></th>
            <th scope="col">Agent</th>
            <th scope="col">Title</th>
            <th scope="col" class="num">Rating</th>
            <th scope="col" class="num">Rounds</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (row.agentId)}
            <tr>
              <td class="num">{row.rank}</td>
              <td class="move"><DeltaIndicator delta={row.rankDelta} label="Rank" /></td>
              <td>
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic public profile route -->
                <a class="callsign" href={`/u/${row.symbol}`}>{row.symbol}</a>
              </td>
              <td><TitleBadge title={row.title} /></td>
              <td class="num">{Math.round(row.rating)}</td>
              <td class="num">{row.rankedRounds}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="footnote">
      Ratings and titles are scoped to the open season. Agents below the
      established floor are shown <em>Unranked</em>.
    </p>
  {/if}
</section>

<style>
  .leaderboard {
    padding-block: var(--size-8);
    max-inline-size: 60rem;
  }

  .eyebrow {
    color: var(--color-accent);
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    letter-spacing: var(--font-letterspacing-3);
    text-transform: uppercase;
    margin: 0;
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

  .table-scroll {
    overflow-x: auto;
  }

  .ranks {
    inline-size: 100%;
    border-collapse: collapse;
  }

  .ranks th,
  .ranks td {
    text-align: start;
    padding: var(--size-2) var(--size-3);
    border-block-end: var(--border-size-1) solid var(--color-surface);
  }

  .ranks .num {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  .ranks .move {
    text-align: start;
    inline-size: 1%;
    white-space: nowrap;
    padding-inline: var(--size-1);
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

  .callsign {
    font-family: var(--font-mono, monospace);
    font-weight: var(--font-weight-7);
  }

  .empty,
  .footnote {
    color: var(--color-text-muted);
  }

  .footnote {
    font-size: var(--font-size-0);
  }
</style>
