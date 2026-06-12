<script lang="ts">
  import { superForm } from "sveltekit-superforms";

  let { data } = $props();

  const { enhance, errors, form, message, submitting } = superForm(data.form);
</script>

<svelte:head>
  <title>Your agents · rankings.trade</title>
  <meta name="description" content="Register and claim your SpaceTraders agent callsigns." />
</svelte:head>

<section class="agents flow wrapper">
  <h1>Your agents</h1>
  <p class="lede">
    Claim the SpaceTraders callsigns you control. Claims are trust-based and start as
    <strong>unverified</strong>; an admin can resolve any disputes.
  </p>

  {#if $message}
    <p class="form-message" role="status">{$message}</p>
  {/if}

  <form method="POST" use:enhance class="claim-form">
    <div class="field">
      <label for="symbol">Callsign</label>
      <div class="field-row">
        <input
          id="symbol"
          name="symbol"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="RANKBOT"
          aria-invalid={$errors.symbol ? "true" : undefined}
          aria-describedby={$errors.symbol ? "symbol-error" : undefined}
          bind:value={$form.symbol}
        />
        <button type="submit" class="submit-button" disabled={$submitting}>
          {$submitting ? "Claiming…" : "Claim"}
        </button>
      </div>
      {#if $errors.symbol}
        <p id="symbol-error" class="field-error">{$errors.symbol}</p>
      {/if}
    </div>
  </form>

  {#if data.agents.length === 0}
    <p class="empty">You haven't claimed any agents yet.</p>
  {:else}
    <ul class="agent-list">
      {#each data.agents as agent (agent.id)}
        <li class="agent-row">
          <span class="agent-symbol">{agent.symbol}</span>
          {#if agent.verified === 0}
            <span class="badge badge-unverified">Unverified</span>
          {:else}
            <span class="badge badge-verified">Verified</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .agents {
    padding-block: var(--size-8);
    max-inline-size: 48rem;
  }

  h1 {
    font-size: var(--font-size-fluid-2);
    margin: 0;
  }

  .lede {
    color: var(--color-text-muted);
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
    text-transform: uppercase;
  }

  .field-error {
    color: var(--color-accent);
    font-size: var(--font-size-0);
  }

  .form-message {
    color: var(--color-link);
    font-weight: var(--font-weight-7);
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

  .submit-button:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .empty {
    color: var(--color-text-muted);
  }

  .agent-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  .agent-row {
    display: flex;
    align-items: center;
    gap: var(--size-3);
    padding: var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
  }

  .agent-symbol {
    font-weight: var(--font-weight-7);
    font-family: var(--font-mono, monospace);
  }

  .badge {
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
  }

  .badge-unverified {
    background: var(--color-surface);
    color: var(--color-text-muted);
  }

  .badge-verified {
    background: var(--color-link);
    color: var(--color-background);
  }
</style>
