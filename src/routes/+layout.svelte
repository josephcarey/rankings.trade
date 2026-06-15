<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { ClerkProvider, SignOutButton } from "svelte-clerk";

  import "../styles/app.css";
  import type { ThemeMode } from "../lib/theme";

  import MobileDrawer from "../lib/components/nav/mobile-drawer.svelte";
  import NavDropdown from "../lib/components/nav/nav-dropdown.svelte";
  import ThemeToggle from "../lib/components/theme-toggle.svelte";

  let { children, data } = $props();

  let themeMode = $state<ThemeMode>(data.theme);

  const handleNavClick = async () => {
    if ($page.route.id !== "/") {
      // svelte/no-navigation-without-resolve is not applicable for root home navigation
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      await goto("/");
    }
  };
</script>

{#snippet publicLinks()}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public content route -->
  <a class="nav-link" href="/live">Live</a>
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public content route -->
  <a class="nav-link" href="/leaderboard">Leaderboard</a>
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public content route -->
  <a class="nav-link" href="/hall-of-fame">Hall of Fame</a>
{/snippet}

{#snippet rulesLink()}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public content route -->
  <a class="nav-link" href="/rules">Rules</a>
{/snippet}

{#snippet leaguePanel()}
  {#each data.leagues as league (league.id)}
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic league detail route -->
    <a class="nav-link" href={`/leagues/${league.id}`}>{league.name}</a>
  {/each}
  {#if data.leagues.length === 0}
    <span class="nav-empty">You're not in any leagues yet.</span>
  {/if}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static authed route -->
  <a class="nav-link nav-manage" href="/leagues">All leagues / Manage</a>
{/snippet}

{#snippet userPanel()}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static authed route -->
  <a class="nav-link" href="/agents">Agents</a>
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static authed route -->
  <a class="nav-link" href="/settings">Settings</a>
  <ThemeToggle bind:mode={themeMode} compact label="Theme" />
  <SignOutButton redirectUrl="/" class="nav-link signout-button">Log out</SignOutButton>
{/snippet}

{#snippet userIcon()}
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="24" height="24">
    <path
      d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5Z"
      fill="currentColor"
    />
  </svg>
{/snippet}

<ClerkProvider>
  <a class="skip-link" href="#main-content">Skip to main content</a>

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

      <div class="nav-desktop">
        {@render publicLinks()}
        {#if data.nav.signedIn}
          <NavDropdown label="Leagues">
            {@render leaguePanel()}
          </NavDropdown>
          {@render rulesLink()}
          <NavDropdown
            label="Account"
            triggerClass="nav-icon-button"
            triggerLabel="Account menu"
            trigger={userIcon}
          >
            {@render userPanel()}
          </NavDropdown>
        {:else}
          {@render rulesLink()}
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public route -->
          <a class="nav-link" href="/sign-in">Sign in</a>
          <ThemeToggle bind:mode={themeMode} compact label="Theme" />
        {/if}
      </div>

      <div class="nav-mobile">
        <MobileDrawer label="Menu">
          <nav class="drawer-nav" aria-label="Primary">
            {@render publicLinks()}
            {@render rulesLink()}
          </nav>
          {#if data.nav.signedIn}
            <details class="drawer-section">
              <summary>Leagues</summary>
              <div class="drawer-group">{@render leaguePanel()}</div>
            </details>
            <div class="drawer-section">
              <p class="drawer-heading">Account</p>
              <div class="drawer-group">{@render userPanel()}</div>
            </div>
          {:else}
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static public route -->
            <a class="nav-link" href="/sign-in">Sign in</a>
            <ThemeToggle bind:mode={themeMode} label="Theme" />
          {/if}
        </MobileDrawer>
      </div>
    </div>
  </nav>

  <main id="main-content">
    {@render children()}
  </main>

  <footer class="site-footer">
    <div class="footer-inner wrapper">
      <span class="footer-wordmark">rankings.trade</span>
      <nav class="footer-links" aria-label="Footer">
        <a
          class="footer-link"
          href="https://github.com/josephcarey/rankings.trade"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <a
          class="footer-link"
          href="https://github.com/josephcarey/rankings.trade/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          Report an issue
        </a>
      </nav>
    </div>
  </footer>
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
    display: inline-flex;
    align-items: center;
    min-block-size: 44px;
  }

  .nav-brand:hover {
    color: var(--color-accent);
  }

  .nav-spacer {
    flex: 1;
  }

  .nav-desktop {
    display: flex;
    align-items: center;
    gap: var(--size-4);
  }

  .nav-mobile {
    display: none;
  }

  @media (max-width: 640px) {
    .nav-desktop {
      display: none;
    }

    .nav-mobile {
      display: inline-flex;
    }
  }

  :global(.nav-link) {
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
    display: inline-flex;
    align-items: center;
    min-block-size: 44px;
  }

  :global(.nav-link:hover) {
    color: var(--color-accent);
  }

  .nav-icon-button {
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
    transition: color 150ms ease;
  }

  .nav-icon-button:hover {
    color: var(--color-accent);
  }

  .nav-empty {
    font-size: var(--font-size-0);
    color: var(--color-text-muted);
    padding-block: var(--size-2);
  }

  :global(.nav-manage) {
    margin-block-start: var(--size-1);
    border-block-start: var(--border-size-1) solid var(--color-text-muted);
    font-weight: var(--font-weight-7);
  }

  :global(.signout-button) {
    color: var(--color-accent);
    text-align: start;
    justify-content: flex-start;
  }

  .drawer-nav {
    display: flex;
    flex-direction: column;
  }

  .drawer-section {
    border-block-start: var(--border-size-1) solid var(--color-text-muted);
    padding-block-start: var(--size-3);
  }

  .drawer-section summary {
    min-block-size: 44px;
    display: flex;
    align-items: center;
    font-weight: var(--font-weight-7);
    cursor: pointer;
  }

  .drawer-heading {
    margin: 0;
    min-block-size: 44px;
    display: flex;
    align-items: center;
    font-weight: var(--font-weight-7);
  }

  .drawer-group {
    display: flex;
    flex-direction: column;
    gap: var(--size-1);
    padding-inline-start: var(--size-2);
  }

  .skip-link {
    position: absolute;
    inset-block-start: var(--size-2);
    inset-inline-start: var(--size-2);
    z-index: 200;
    padding: var(--size-2) var(--size-3);
    background: var(--color-surface);
    color: var(--color-text);
    border-radius: var(--radius-2);
    font-weight: var(--font-weight-7);
    transform: translateY(-200%);
    transition: transform 150ms ease;
  }

  .skip-link:focus {
    transform: translateY(0);
  }

  main {
    padding-block: var(--size-8);
  }

  .site-footer {
    border-block-start: var(--border-size-1) solid var(--color-text-muted);
    background-color: var(--color-surface);
    padding-block: var(--size-4);
  }

  .footer-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-2) var(--size-4);
  }

  .footer-wordmark {
    font-size: var(--font-size-0);
    color: var(--color-text-muted);
  }

  .footer-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4);
  }

  .footer-link {
    font-size: var(--font-size-0);
    color: var(--color-text-muted);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    min-block-size: 44px;
    transition: color 150ms ease;
  }

  .footer-link:hover {
    color: var(--color-accent);
  }
</style>
