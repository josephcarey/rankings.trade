<script lang="ts">
  import type { SeasonBadgeMeta } from "../seasons/recognition";

  import { seasonBadge } from "../seasons/recognition";

  // `closed` defaults to true: a badge is only ever rendered from archived (closed)
  // standings, but the prop keeps immutability explicit and lets callers pass it
  // straight from `closed_at !== null`.
  let { rank, closed = true }: { rank: number; closed?: boolean } = $props();

  const badge: null | SeasonBadgeMeta = $derived(seasonBadge(rank, closed));
</script>

{#if badge}
  <span class="season-badge place-{badge.slug}" title={badge.label}>
    <svg class="medal" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="10" r="5" fill="currentColor" />
      <path d="M5 1h2l1 4H6L5 1zm4 0h2l-1 4H8l1-4z" fill="currentColor" />
    </svg>
    {badge.label}
  </span>
{/if}

<style>
  .season-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--size-1);
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
    border: var(--border-size-1) solid transparent;
    white-space: nowrap;
  }

  .medal {
    inline-size: 0.85em;
    block-size: 0.85em;
    flex: none;
  }

  /* Gold — Season Champion. */
  .place-champion {
    background: var(--yellow-3, #fef08a);
    color: var(--yellow-11, #854d0e);
    border-color: var(--yellow-7, #ca8a04);
    box-shadow: 0 0 0 1px var(--yellow-5, #fde047);
  }

  /* Silver — runner-up. */
  .place-runner-up {
    background: var(--gray-3, #e5e7eb);
    color: var(--gray-9, #374151);
    border-color: var(--gray-6, #9ca3af);
  }

  /* Bronze — third place. */
  .place-third {
    background: var(--orange-3, #fed7aa);
    color: var(--orange-11, #9a3412);
    border-color: var(--orange-7, #ea580c);
  }
</style>
