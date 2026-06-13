<script lang="ts">
  import type { TitleBadge } from "../titles/badge";

  import { titleBadge } from "../titles/badge";

  let { title }: { title: null | string | undefined } = $props();

  const badge: TitleBadge = $derived(titleBadge(title));
</script>

<span class="title-badge tier-{badge.slug}" data-known={badge.known}>{badge.label}</span>

<style>
  .title-badge {
    display: inline-block;
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
    border: var(--border-size-1) solid transparent;
    white-space: nowrap;
    background: var(--color-surface);
    color: var(--color-text-muted);
  }

  /* Off-ladder / no current title. */
  .tier-unranked {
    background: var(--color-surface);
    color: var(--color-text-muted);
  }

  /* Lower (threshold) tiers — cool, understated. */
  .tier-cadet {
    background: var(--gray-2, #e5e7eb);
    color: var(--gray-9, #1f2933);
  }
  .tier-ensign {
    background: var(--cyan-2, #cffafe);
    color: var(--cyan-11, #155e75);
  }
  .tier-lieutenant {
    background: var(--teal-2, #ccfbf1);
    color: var(--teal-11, #115e59);
  }
  .tier-commander {
    background: var(--green-2, #dcfce7);
    color: var(--green-11, #166534);
  }
  .tier-captain {
    background: var(--lime-3, #d9f99d);
    color: var(--lime-11, #3f6212);
  }
  .tier-commodore {
    background: var(--yellow-3, #fef08a);
    color: var(--yellow-11, #854d0e);
  }

  /* Elite tiers — warm, prominent, bordered. */
  .tier-colonel {
    background: var(--orange-3, #fed7aa);
    color: var(--orange-11, #9a3412);
    border-color: var(--orange-7, #ea580c);
  }
  .tier-admiral {
    background: var(--red-3, #fecaca);
    color: var(--red-11, #991b1b);
    border-color: var(--red-7, #dc2626);
  }
  .tier-fleet-admiral {
    background: var(--violet-4, #ddd6fe);
    color: var(--violet-11, #5b21b6);
    border-color: var(--violet-7, #7c3aed);
    box-shadow: 0 0 0 1px var(--violet-5, #c4b5fd);
  }
</style>
