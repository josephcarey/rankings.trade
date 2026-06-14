<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { type Snippet, tick } from "svelte";

  import { clickOutside } from "./interactions";

  type Props = {
    /** Accessible label / default trigger text. */
    label: string;
    /** Dropdown contents (links, controls). */
    children: Snippet;
    /** Optional custom trigger content (e.g. an icon). Defaults to `label`. */
    trigger?: Snippet;
    /** CSS class for the trigger button. */
    triggerClass?: string;
    /** Extra accessible label for the trigger when using a custom icon. */
    triggerLabel?: string;
    /** Panel edge alignment. */
    align?: "start" | "end";
  };

  let {
    label,
    children,
    trigger,
    triggerClass = "nav-link",
    triggerLabel,
    align = "end",
  }: Props = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement>();
  let panelEl = $state<HTMLDivElement>();
  const uid = $props.id();
  const panelId = `nav-dropdown-${uid}`;

  function close(returnFocus = true) {
    if (!open) return;
    open = false;
    if (returnFocus) triggerEl?.focus();
  }

  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      panelEl?.querySelector<HTMLElement>("a, button")?.focus();
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }

  // The layout persists across client-side navigation, so a link click inside
  // the panel would otherwise leave it open — close it after navigating.
  afterNavigate(() => close(false));
</script>

<div class="dropdown" use:clickOutside={() => close(false)} onkeydown={onKeydown}>
  <button
    bind:this={triggerEl}
    type="button"
    class={triggerClass}
    aria-expanded={open}
    aria-controls={panelId}
    aria-label={triggerLabel}
    onclick={toggle}
  >
    {#if trigger}{@render trigger()}{:else}{label}{/if}
  </button>
  {#if open}
    <div
      bind:this={panelEl}
      id={panelId}
      class="dropdown-panel"
      class:align-start={align === "start"}
      role="group"
      aria-label={label}
    >
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .dropdown {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .dropdown-panel {
    position: absolute;
    inset-block-start: calc(100% + var(--size-2));
    inset-inline-end: 0;
    z-index: 110;
    display: flex;
    flex-direction: column;
    gap: var(--size-1);
    min-inline-size: 12rem;
    padding: var(--size-2);
    background: var(--color-surface);
    border: var(--border-size-1) solid var(--color-text-muted);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-3);
  }

  .dropdown-panel.align-start {
    inset-inline-end: auto;
    inset-inline-start: 0;
  }
</style>
