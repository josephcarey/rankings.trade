<script lang="ts">
  import SeasonBadge from "../../lib/components/season-badge.svelte";

  let { data } = $props();
</script>

<svelte:head>
  <title>Hall of Fame · rankings.trade</title>
  <meta
    name="description"
    content="Every past SpaceTraders Universe season's champion and podium — the rankings.trade hall of fame."
  />
</svelte:head>

<section class="hall flow wrapper">
  <header class="head">
    <p class="eyebrow">Universe</p>
    <h1>Hall of Fame</h1>
    <p class="lede">Champions and podium finishers of every closed season.</p>
  </header>

  {#if data.seasons.length === 0}
    <p class="empty">
      No seasons have closed yet. The first champion will be crowned when the
      current season ends.
    </p>
  {:else}
    <ol class="seasons">
      {#each data.seasons as season (season.seasonId)}
        <li class="season card">
          <h2 class="season-label">{season.label}</h2>
          <ol class="podium">
            {#each season.podium as entry (entry.agentId)}
              <li class="entry" data-rank={entry.rank}>
                <span class="rank num">#{entry.rank}</span>
                <SeasonBadge rank={entry.rank} />
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic public profile route -->
                <a class="callsign" href={`/u/${entry.symbol}`}>{entry.symbol}</a>
                {#if entry.title}<span class="title muted">{entry.title}</span>{/if}
                <span class="rating num">{Math.round(entry.rating)}</span>
              </li>
            {/each}
          </ol>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .hall {
    padding-block: var(--size-8);
    max-inline-size: 52rem;
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

  .lede,
  .empty,
  .muted {
    color: var(--color-text-muted);
  }

  .seasons {
    list-style: none;
    padding: 0;
    margin: var(--size-6) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-5);
  }

  .card {
    padding: var(--size-4);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
  }

  .season-label {
    font-size: var(--font-size-3);
    margin: 0 0 var(--size-3);
  }

  .podium {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  .entry {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-3);
    padding: var(--size-2) var(--size-3);
    border-block-end: var(--border-size-1) solid var(--color-surface);
  }

  .entry[data-rank="1"] {
    background: var(--color-surface);
    border-radius: var(--radius-1);
  }

  .rank {
    font-weight: var(--font-weight-7);
    min-inline-size: 2.5rem;
  }

  .callsign {
    font-family: var(--font-mono, monospace);
    font-weight: var(--font-weight-7);
  }

  .title {
    font-size: var(--font-size-0);
  }

  .rating {
    margin-inline-start: auto;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }
</style>
