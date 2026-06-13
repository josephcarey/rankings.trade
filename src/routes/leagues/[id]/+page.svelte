<script lang="ts">
  import { enhance as formEnhance } from "$app/forms";
  import { superForm } from "sveltekit-superforms";

  let { data, form: action } = $props();

  const { enhance, errors, form, message, submitting } = superForm(data.form);

  const addError = $derived(
    action?.action === "addParticipant" && "error" in action
      ? action.error
      : undefined,
  );
</script>

<svelte:head>
  <title>{data.league.name} · rankings.trade</title>
</svelte:head>

<section class="league flow wrapper">
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static leagues route -->
  <a class="back" href="/leagues">← Leagues</a>

  <header class="league-header">
    <h1>{data.league.name}</h1>
    <span class="badge badge-{data.league.visibility}">{data.league.visibility}</span>
  </header>

  {#if data.league.description}
    <p class="description">{data.league.description}</p>
  {/if}

  <section class="participants flow">
    <h2>Participants</h2>

    {#if data.canManage}
      <form method="POST" action="?/addParticipant" use:formEnhance class="add-form">
        <div class="field">
          <label for="symbol">Add by callsign</label>
          <div class="field-row">
            <input
              id="symbol"
              name="symbol"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="RANKBOT"
            />
            <button type="submit" class="submit-button">Add</button>
          </div>
          {#if addError}
            <p class="field-error">{addError}</p>
          {/if}
        </div>
      </form>
    {/if}

    {#if data.participants.length === 0}
      <p class="empty">No participants yet.</p>
    {:else}
      <ul class="participant-list">
        {#each data.participants as participant (participant.agent_id)}
          <li class="participant-row">
            <span class="participant-symbol">{participant.symbol}</span>
            {#if participant.owner_user_id === null}
              <span class="badge badge-unclaimed">Unclaimed</span>
            {/if}
            {#if data.canManage}
              <form method="POST" action="?/removeParticipant" use:formEnhance>
                <input type="hidden" name="symbol" value={participant.symbol} />
                <button type="submit" class="remove-button">Remove</button>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if data.canManage}
    <section class="manage flow">
      <h2>Manage league</h2>

      {#if $message}
        <p class="form-message" role="status">{$message}</p>
      {/if}

      <form method="POST" action="?/update" use:enhance class="manage-form flow">
        <div class="field">
          <label for="name">Name</label>
          <input
            id="name"
            name="name"
            type="text"
            autocomplete="off"
            aria-invalid={$errors.name ? "true" : undefined}
            bind:value={$form.name}
          />
          {#if $errors.name}
            <p class="field-error">{$errors.name}</p>
          {/if}
        </div>

        <div class="field">
          <label for="description">Description</label>
          <textarea
            id="description"
            name="description"
            rows="2"
            bind:value={$form.description}
          ></textarea>
          {#if $errors.description}
            <p class="field-error">{$errors.description}</p>
          {/if}
        </div>

        <div class="field">
          <label for="visibility">Visibility</label>
          <select id="visibility" name="visibility" bind:value={$form.visibility}>
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </div>

        <button type="submit" class="submit-button" disabled={$submitting}>
          {$submitting ? "Saving…" : "Save changes"}
        </button>
      </form>
    </section>
  {/if}
</section>

<style>
  .league {
    padding-block: var(--size-8);
    max-inline-size: 48rem;
  }

  .back {
    color: var(--color-text-muted);
    font-size: var(--font-size-0);
  }

  .league-header {
    display: flex;
    align-items: center;
    gap: var(--size-3);
  }

  h1 {
    font-size: var(--font-size-fluid-2);
    margin: 0;
  }

  .description {
    color: var(--color-text-muted);
  }

  .participants {
    margin-block-start: var(--size-6);
  }

  .add-form {
    margin-block-end: var(--size-4);
  }

  .field-row {
    display: flex;
    gap: var(--size-2);
    align-items: center;
  }

  .participant-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  .participant-row {
    display: flex;
    align-items: center;
    gap: var(--size-3);
    padding: var(--size-2) var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
  }

  .participant-symbol {
    font-weight: var(--font-weight-7);
    font-family: var(--font-mono, monospace);
  }

  .remove-button {
    margin-inline-start: auto;
    padding: var(--size-1) var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
    background: var(--color-background);
    color: var(--color-text-muted);
    cursor: pointer;
  }

  .empty {
    color: var(--color-text-muted);
  }

  .badge-unclaimed {
    background: var(--color-surface);
    color: var(--color-text-muted);
  }

  .manage {
    margin-block-start: var(--size-6);
    padding-block-start: var(--size-4);
    border-block-start: var(--border-size-1) solid var(--color-surface);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  input,
  textarea,
  select {
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

  .form-message {
    color: var(--color-link);
    font-weight: var(--font-weight-7);
  }

  .submit-button {
    align-self: start;
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

  .badge {
    font-size: var(--font-size-0);
    font-weight: var(--font-weight-7);
    padding: var(--size-1) var(--size-2);
    border-radius: var(--radius-1);
    text-transform: capitalize;
  }

  .badge-private {
    background: var(--color-surface);
    color: var(--color-text-muted);
  }

  .badge-public {
    background: var(--color-link);
    color: var(--color-background);
  }
</style>
