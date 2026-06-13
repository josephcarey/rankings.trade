<script lang="ts">
  import type { SeasonBadgeMeta } from "../seasons/recognition";

  import { seasonBadge } from "../seasons/recognition";
  import Badge from "./badge.svelte";

  // `closed` defaults to true: a badge is only ever rendered from archived (closed)
  // standings, but the prop keeps immutability explicit and lets callers pass it
  // straight from `closed_at !== null`.
  let { rank, closed = true }: { rank: number; closed?: boolean } = $props();

  const badge: null | SeasonBadgeMeta = $derived(seasonBadge(rank, closed));
</script>

{#if badge}
  <Badge tone={`place-${badge.slug}`} label={badge.label} title={badge.label} icon={medal} />
{/if}

{#snippet medal()}
  <svg class="medal" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="10" r="5" fill="currentColor" />
    <path d="M5 1h2l1 4H6L5 1zm4 0h2l-1 4H8l1-4z" fill="currentColor" />
  </svg>
{/snippet}

<style>
  .medal {
    inline-size: 0.85em;
    block-size: 0.85em;
    flex: none;
  }
</style>
