<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();

  // The raw token is present only in the immediate action result and is shown
  // exactly once; it is never part of `data` (the reloaded list).
  const secret = $derived(form?.secret as string | undefined);
</script>

<svelte:head>
  <title>{data.agent.symbol} tokens · rankings.trade</title>
  <meta name="description" content="Manage API tokens for your SpaceTraders agent." />
</svelte:head>

<section class="tokens flow wrapper">
  <p class="back">
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static authed route -->
    <a href="/agents">← Your agents</a>
  </p>

  <h1>
    <span class="agent-symbol">{data.agent.symbol}</span>
    {#if data.agent.verified === 0}
      <span class="badge badge-unverified">Unverified</span>
    {:else}
      <span class="badge badge-verified">Verified</span>
    {/if}
  </h1>
  <p class="lede">
    API tokens authenticate this agent's bot. Each token is shown <strong>once</strong> at
    creation — store it somewhere safe.
  </p>

  {#if secret}
    <div class="secret" role="status">
      <p class="secret-label">New token — copy it now, it won't be shown again:</p>
      <code class="secret-value">{secret}</code>
    </div>
  {/if}

  <form method="POST" action="?/create" use:enhance class="create-form">
    <div class="field">
      <label for="label">Token label</label>
      <div class="field-row">
        <input
          id="label"
          name="label"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="CI deploy"
          maxlength="60"
        />
        <button type="submit" class="submit-button">Generate token</button>
      </div>
      {#if form?.action === "create" && form?.error}
        <p class="field-error">{form.error}</p>
      {/if}
    </div>
  </form>

  {#if data.tokens.length === 0}
    <p class="empty">No tokens yet. Generate one above.</p>
  {:else}
    <ul class="token-list">
      {#each data.tokens as token (token.id)}
        <li class="token-row" class:revoked={token.status === "revoked"}>
          <div class="token-main">
            <span class="token-label">{token.label}</span>
            <code class="token-prefix">{token.token_prefix}…</code>
          </div>
          <dl class="token-meta">
            <div><dt>Created</dt><dd>{token.created_at}</dd></div>
            <div><dt>Last used</dt><dd>{token.last_used_at ?? "Never"}</dd></div>
            <div>
              <dt>Status</dt>
              <dd>
                {#if token.status === "active"}
                  <span class="badge badge-active">Active</span>
                {:else}
                  <span class="badge badge-revoked">Revoked</span>
                {/if}
              </dd>
            </div>
          </dl>
          {#if token.status === "active"}
            <div class="token-actions">
              <form method="POST" action="?/rotate" use:enhance>
                <input type="hidden" name="tokenId" value={token.id} />
                <button type="submit" class="ghost-button">Rotate</button>
              </form>
              <form method="POST" action="?/revoke" use:enhance>
                <input type="hidden" name="tokenId" value={token.id} />
                <button type="submit" class="ghost-button danger">Revoke</button>
              </form>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .tokens {
    padding-block: var(--size-8);
    max-inline-size: 52rem;
  }

  .back a {
    color: var(--color-text-muted);
    text-decoration: none;
  }

  h1 {
    font-size: var(--font-size-fluid-2);
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--size-3);
  }

  .lede {
    color: var(--color-text-muted);
  }

  .agent-symbol {
    font-family: var(--font-mono, monospace);
  }

  .secret {
    padding: var(--size-3);
    border: var(--border-size-2) solid var(--color-accent);
    border-radius: var(--radius-2);
    background: var(--color-surface);
  }

  .secret-label {
    margin: 0 0 var(--size-2);
    font-weight: var(--font-weight-7);
  }

  .secret-value {
    display: block;
    overflow-wrap: anywhere;
    font-family: var(--font-mono, monospace);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  .field-row {
    display: flex;
    gap: var(--size-2);
    align-items: center;
  }

  input[type="text"] {
    flex: 1;
    padding: var(--size-2);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
    background: var(--color-background);
    color: var(--color-text);
  }

  .field-error {
    color: var(--color-accent);
    font-size: var(--font-size-0);
  }

  .submit-button {
    padding: var(--size-2) var(--size-4);
    border: none;
    border-radius: var(--radius-2);
    background: var(--color-accent);
    color: var(--color-background);
    font-weight: var(--font-weight-7);
    cursor: pointer;
  }

  .empty {
    color: var(--color-text-muted);
  }

  .token-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-3);
  }

  .token-row {
    display: grid;
    gap: var(--size-3);
    padding: var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
  }

  .token-row.revoked {
    opacity: 0.6;
  }

  .token-main {
    display: flex;
    align-items: baseline;
    gap: var(--size-3);
  }

  .token-label {
    font-weight: var(--font-weight-7);
  }

  .token-prefix {
    font-family: var(--font-mono, monospace);
    color: var(--color-text-muted);
  }

  .token-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-4);
    margin: 0;
  }

  .token-meta dt {
    font-size: var(--font-size-0);
    color: var(--color-text-muted);
  }

  .token-meta dd {
    margin: 0;
  }

  .token-actions {
    display: flex;
    gap: var(--size-2);
  }

  .ghost-button {
    padding: var(--size-1) var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .ghost-button.danger {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .badge {
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
  }

  .badge-unverified,
  .badge-revoked {
    background: var(--color-surface);
    color: var(--color-text-muted);
  }

  .badge-verified,
  .badge-active {
    background: var(--color-link);
    color: var(--color-background);
  }
</style>
