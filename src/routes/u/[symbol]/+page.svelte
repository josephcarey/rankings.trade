<script lang="ts">
  import CreditsChart from "../../../lib/components/credits-chart.svelte";
  import DeltaIndicator from "../../../lib/components/delta-indicator.svelte";
  import RatingChart from "../../../lib/components/rating-chart.svelte";
  import SeasonBadge from "../../../lib/components/season-badge.svelte";
  import TitleBadge from "../../../lib/components/title-badge.svelte";

  let { data } = $props();
</script>

<svelte:head>
  <title>{data.agent.symbol} · rankings.trade</title>
  <meta name="description" content={`Public profile for SpaceTraders agent ${data.agent.symbol}.`} />
</svelte:head>

<section class="profile flow wrapper">
  <header class="head">
    <h1>
      <span class="callsign">{data.agent.symbol}</span>
      {#if data.agent.verified === 1}
        <span class="badge badge-verified">Verified</span>
      {/if}
    </h1>

    {#if data.current}
      <div class="current">
        <TitleBadge title={data.current.title} />
        <span class="stat">
          Rank #{data.current.rank}
          <DeltaIndicator delta={data.delta?.rankDelta ?? null} label="Rank" />
        </span>
        <span class="stat">
          Rating {Math.round(data.current.rating)}
          <DeltaIndicator delta={data.delta?.ratingDelta ?? null} label="Rating" />
        </span>
        {#if data.seasonLabel}<span class="muted">· {data.seasonLabel}</span>{/if}
      </div>
    {:else}
      <p class="muted">
        No current season rating{data.seasonLabel ? ` for ${data.seasonLabel}` : ""}.
      </p>
    {/if}

    {#if data.canManage}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- owner dashboard route -->
      <a class="manage" href={`/agents/${data.agent.symbol}`}>Manage this agent →</a>
    {/if}
  </header>

  <section class="card flow">
    <h2>Credits this season</h2>
    <CreditsChart chart={data.chart} caption={`Credits for ${data.agent.symbol} this season`} />
  </section>

  <section class="card flow">
    <h2>Rating this season</h2>
    <RatingChart chart={data.ratingChart} caption={`Glicko-2 rating for ${data.agent.symbol} this season`} />
  </section>

  <section class="card flow">
    <h2>Leagues</h2>
    {#if data.leagues.length === 0}
      <p class="muted">Not a member of any leagues you can see.</p>
    {:else}
      <ul class="leagues">
        {#each data.leagues as league (league.id)}
          <li>
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic league route -->
            <a href={`/leagues/${league.id}`}>{league.name}</a>
            <span class="badge badge-{league.visibility}">{league.visibility}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card flow">
    <h2>Season history</h2>
    {#if data.history.length === 0}
      <p class="muted">No archived seasons yet.</p>
    {:else}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Season</th>
              <th scope="col">Title</th>
              <th scope="col">Recognition</th>
              <th scope="col" class="num">Rank</th>
              <th scope="col" class="num">Rating</th>
              <th scope="col" class="num">Rounds</th>
            </tr>
          </thead>
          <tbody>
            {#each data.history as row (row.seasonLabel)}
              <tr>
                <td>{row.seasonLabel}</td>
                <td><TitleBadge title={row.title} /></td>
                <td><SeasonBadge rank={row.rank} closed={row.closed} /></td>
                <td class="num">{row.rank}</td>
                <td class="num">{Math.round(row.rating)}</td>
                <td class="num">{row.rankedRounds}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="card flow">
    <h2>Milestones</h2>
    {#if data.milestones.length === 0}
      <p class="muted">No milestones yet.</p>
    {:else}
      <ul class="feed">
        {#each data.milestones as milestone, i (i)}
          <li class="feed-item">
            <div class="feed-head">
              <span class="feed-label">{milestone.label}</span>
              {#if milestone.recognized}
                <span class="badge badge-recognized">Recognized</span>
              {:else}
                <span class="badge badge-generic">Generic</span>
              {/if}
              <time class="muted">{milestone.ts}</time>
            </div>
            {#if milestone.fields.length > 0}
              <dl class="fields">
                {#each milestone.fields as field (field.key)}
                  <div><dt>{field.key}</dt><dd>{field.value}</dd></div>
                {/each}
              </dl>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card flow">
    <h2>Logs</h2>
    {#if data.logs.length === 0}
      <p class="muted">No logs yet.</p>
    {:else}
      <ul class="feed">
        {#each data.logs as log, i (i)}
          <li class="feed-item">
            <time class="muted">{log.ts}</time>
            <p class="log-text">{log.text}</p>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</section>

<style>
  .profile {
    padding-block: var(--size-8);
    max-inline-size: 52rem;
  }

  h1 {
    font-size: var(--font-size-fluid-2);
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--size-3);
  }

  .callsign {
    font-family: var(--font-mono, monospace);
  }

  .current {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-3);
    margin-block-start: var(--size-2);
  }

  .stat {
    display: inline-flex;
    align-items: baseline;
    gap: var(--size-1);
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-weight-7);
  }

  .muted {
    color: var(--color-text-muted);
  }

  .manage {
    display: inline-block;
    margin-block-start: var(--size-2);
    font-weight: var(--font-weight-6);
  }

  .card {
    margin-block-start: var(--size-6);
    padding-block-start: var(--size-4);
    border-block-start: var(--border-size-1) solid var(--color-surface);
  }

  .table-scroll {
    overflow-x: auto;
  }

  table {
    inline-size: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    text-align: start;
    padding: var(--size-2) var(--size-3);
    border-block-end: var(--border-size-1) solid var(--color-surface);
  }

  .num {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  .leagues,
  .feed {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  .leagues li {
    display: flex;
    align-items: center;
    gap: var(--size-2);
  }

  .feed-item {
    padding: var(--size-2) var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
  }

  .feed-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-2);
  }

  .feed-label {
    font-weight: var(--font-weight-7);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-3);
    margin: var(--size-2) 0 0;
    font-size: var(--font-size-0);
  }

  .fields dt {
    color: var(--color-text-muted);
  }

  .fields dd {
    margin: 0;
    font-family: var(--font-mono, monospace);
  }

  .log-text {
    margin: var(--size-1) 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .badge {
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
    text-transform: capitalize;
  }

  .badge-verified,
  .badge-recognized,
  .badge-public {
    background: var(--color-link);
    color: var(--color-background);
  }

  .badge-generic,
  .badge-private {
    background: var(--color-surface);
    color: var(--color-text-muted);
  }
</style>
