<script lang="ts">
  import { findModule } from "../../../lib/content/rules";
  import { ruleModules } from "../../../lib/content/rules-registry";

  let { data } = $props();

  const Topic = $derived(findModule(ruleModules, data.topic.slug)?.default);
</script>

<svelte:head>
  <title>{data.topic.title} · rankings.trade</title>
  <meta name="description" content={data.topic.summary} />
</svelte:head>

<p class="back">
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public content route -->
  <a href="/rules">← All topics</a>
</p>

{#if Topic}
  <Topic />
{/if}

<style>
  .back {
    font-size: var(--font-size-0);
  }
</style>
