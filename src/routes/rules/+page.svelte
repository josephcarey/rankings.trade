<script lang="ts">
  import { buildTopicIndex } from "../../lib/content/rules";
  import { ruleModules } from "../../lib/content/rules-registry";

  const topics = buildTopicIndex(ruleModules);
</script>

<svelte:head>
  <title>Rules &amp; help · rankings.trade</title>
  <meta
    name="description"
    content="Learn how rankings.trade works: leagues, rounds, seasons, ratings, titles, agents, bot tokens, logs, and milestones."
  />
</svelte:head>

<h1>Rules &amp; help</h1>
<p class="lede">
  New to rankings.trade? These pages explain the core concepts. Pick a topic to get started.
</p>

<ul class="topic-list">
  {#each topics as topic (topic.slug)}
    <li class="topic">
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public content route -->
      <a class="topic-link" href={`/rules/${topic.slug}`}>{topic.title}</a>
      <p class="topic-summary">{topic.summary}</p>
    </li>
  {/each}
</ul>

<style>
  .lede {
    color: var(--color-text-muted);
  }

  .topic-list {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--size-5);
  }

  .topic-link {
    font-size: var(--font-size-3);
    font-weight: var(--font-weight-7);
  }

  .topic-summary {
    color: var(--color-text-muted);
    margin-block-start: var(--size-1);
  }
</style>
