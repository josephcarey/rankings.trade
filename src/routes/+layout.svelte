<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { ClerkProvider, SignOutButton, UserButton } from "svelte-clerk";

  import "../styles/app.css";

  let { children, data } = $props();

  const handleNavClick = async () => {
    if ($page.route.id !== "/") {
      // svelte/no-navigation-without-resolve is not applicable for root home navigation
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      await goto("/");
    }
  };
</script>

<ClerkProvider>
  <svg class="logo" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      fill="currentColor"
    />
  </svg>

  <nav class="nav">
    <div class="nav-inner wrapper">
      <button
        class="nav-brand"
        onclick={handleNavClick}
        aria-label="Go to home page"
        type="button"
      >
        rankings.trade
      </button>
      <div class="nav-spacer"></div>
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public content route -->
      <a class="nav-link" href="/rules">Rules</a>
      {#if data.nav.signedIn}
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static authed route -->
        <a class="nav-link" href="/agents">Agents</a>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static authed route -->
        <a class="nav-link" href="/settings">Settings</a>
        <UserButton />
        <SignOutButton redirectUrl="/" class="nav-link" />
      {:else}
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public route -->
        <a class="nav-link" href="/sign-in">Sign in</a>
      {/if}
    </div>
  </nav>

  <main>
    {@render children()}
  </main>
</ClerkProvider>

<style>
  .logo {
    position: absolute;
    left: -9999px;
    width: 0;
    height: 0;
  }

  .nav {
    border-bottom: 1px solid var(--color-text-muted);
    background-color: var(--color-surface);
    padding-block: var(--size-3);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .nav-inner {
    display: flex;
    align-items: center;
    gap: var(--size-4);
  }

  .nav-brand {
    font-size: var(--font-size-1);
    font-weight: var(--font-weight-7);
    text-decoration: none;
    color: var(--color-text);
    transition: color 150ms ease;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
  }

  .nav-brand:hover {
    color: var(--color-accent);
  }

  .nav-spacer {
    flex: 1;
  }

  .nav-link {
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-6);
    text-decoration: none;
    color: var(--color-text);
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
    transition: color 150ms ease;
  }

  .nav-link:hover {
    color: var(--color-accent);
  }

  main {
    padding-block: var(--size-8);
  }
</style>
