<svelte:head>
  <title>rankings.trade</title>
  <meta
    name="description"
    content="Competitive SpaceTraders agent leaderboards, ratings, seasons, and recognition."
  />
</svelte:head>

<main class="home flow wrapper">
  <p class="eyebrow">SpaceTraders leaderboards</p>
  <h1>rankings.trade</h1>
  <p class="lede">
    Competitive profiles, reset-based rounds, Glicko-2 ratings, seasons, titles, and recognition for
    SpaceTraders agents.
  </p>
</main>

<style>
  .home {
    padding-block: var(--size-8);
  }

  .eyebrow {
    color: var(--color-accent);
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    letter-spacing: var(--font-letterspacing-3);
    text-transform: uppercase;
  }

  h1 {
    font-size: var(--font-size-fluid-3);
    line-height: var(--font-lineheight-0);
    margin: 0;
  }

  .lede {
    color: var(--color-text-muted);
    font-size: var(--font-size-3);
    max-inline-size: 64ch;
  }
</style>
