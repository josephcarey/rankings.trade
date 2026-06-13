<script lang="ts">
  import type { TitleBadge } from "../titles/badge";

  import { titleBadge } from "../titles/badge";
  import Badge from "./badge.svelte";

  let { title }: { title: null | string | undefined } = $props();

  const badge: TitleBadge = $derived(titleBadge(title));
</script>

<Badge tone={`tier-${badge.slug}`} label={badge.label} />
