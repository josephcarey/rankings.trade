<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { type Snippet, tick } from "svelte";

  import { trapFocus } from "./interactions";

  type Props = {
    /** Drawer contents (links, controls). */
    children: Snippet;
    /** Accessible label for the trigger and dialog. */
    label?: string;
  };

  let { children, label = "Menu" }: Props = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement>();
  let panelEl = $state<HTMLElement>();
  const uid = $props.id();
  const panelId = `mobile-drawer-${uid}`;

  function close(returnFocus = true) {
    if (!open) return;
    open = false;
    if (returnFocus) triggerEl?.focus();
  }

  async function openDrawer() {
    open = true;
    await tick();
    panelEl?.querySelector<HTMLElement>("a, button, input")?.focus();
  }

  function toggle() {
    if (open) {
      close();
    } else {
      void openDrawer();
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (panelEl) trapFocus(panelEl, event);
  }

  afterNavigate(() => close(false));
</script>

<div class="drawer-root">
  <button
    bind:this={triggerEl}
    type="button"
    class="hamburger"
    aria-label={label}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={panelId}
    onclick={toggle}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="24" height="24">
      {#if open}
        <path
          d="M6 6l12 12M18 6L6 18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      {:else}
        <path
          d="M3 6h18M3 12h18M3 18h18"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      {/if}
    </svg>
  </button>

  {#if open}
    <button
      type="button"
      class="drawer-overlay"
      aria-label="Close menu"
      onclick={() => close()}
    ></button>
    <aside
      bind:this={panelEl}
      id={panelId}
      class="drawer-panel"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onkeydown={onKeydown}
    >
      {@render children()}
    </aside>
  {/if}
</div>

<style>
  .drawer-root {
    display: inline-flex;
    align-items: center;
  }

  .hamburger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-inline-size: 44px;
    min-block-size: 44px;
    padding: 0;
    background: none;
    border: none;
    color: var(--color-text);
    cursor: pointer;
  }

  .hamburger:hover {
    color: var(--color-accent);
  }

  .drawer-overlay {
    position: fixed;
    inset: 0;
    z-index: 120;
    padding: 0;
    border: none;
    background: rgb(0 0 0 / 0.4);
    cursor: pointer;
  }

  .drawer-panel {
    position: fixed;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: 130;
    inline-size: min(20rem, 85vw);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--size-3);
    padding: var(--size-6) var(--size-5);
    background: var(--color-surface);
    border-inline-start: var(--border-size-1) solid var(--color-text-muted);
    box-shadow: var(--shadow-4);
  }

  @media (prefers-reduced-motion: no-preference) {
    .drawer-panel {
      animation: drawer-in 150ms ease;
    }
  }

  @keyframes drawer-in {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }
</style>
