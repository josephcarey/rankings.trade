<script lang="ts">
  /**
   * Shared badge pill primitive (§1.3). Base structure and the tier/place/status
   * colour maps live in the global utility layer (`src/styles/utilities.css`) as
   * data; this component just applies a `tone` class and an optional leading
   * `icon`. Domain wrappers (`title-badge`, `season-badge`) map their data to a
   * tone and label.
   */
  import type { Snippet } from "svelte";

  let {
    icon,
    label,
    title,
    tone,
  }: {
    icon?: Snippet;
    label: string;
    title?: string;
    tone: string;
  } = $props();
</script>

<span class={`badge ${tone}`} {title}>
  {#if icon}{@render icon()}{/if}{label}
</span>
