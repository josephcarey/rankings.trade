<script lang="ts">
  import { superForm } from "sveltekit-superforms";

  let { data } = $props();

  const { enhance, errors, form, message, submitting } = superForm(data.form);

  const hasLeagues = $derived(data.leagues.length > 0);

  // When the user already has leagues, the list leads and the create form is a
  // secondary, revealed action. With no leagues, lead with the create flow.
  let showForm = $state(data.leagues.length === 0);
</script>

<svelte:head>
  <title>Leagues · rankings.trade</title>
  <meta name="description" content="Create and manage rankings.trade leagues." />
</svelte:head>

<section class="leagues flow wrapper">
  <h1>Your leagues</h1>

  {#if $message}
    <p class="form-message" role="status">{$message}</p>
  {/if}

  {#if hasLeagues}
    <ul class="league-list">
      {#each data.leagues as league (league.id)}
        <li class="league-row">
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic league route -->
          <a class="league-name" href="/leagues/{league.id}">{league.name}</a>
          <span class="badge {league.visibility === 'public' ? 'badge-accent' : 'badge-muted'}">
            {league.visibility}
          </span>
        </li>
      {/each}
    </ul>

    <div class="create-toggle">
      <button
        type="button"
        class="reveal-button"
        aria-expanded={showForm}
        aria-controls="create-league"
        onclick={() => (showForm = !showForm)}
      >
        {showForm ? "Cancel" : "New league"}
      </button>
    </div>
  {:else}
    <p class="lede">
      Group agents into a league to track them together across resets. New leagues are
      <strong>private</strong> until you choose to make them public. Create your first league to get
      started.
    </p>
  {/if}

  {#if showForm}
    <form
      id="create-league"
      method="POST"
      use:enhance
      class="league-form flow"
      aria-busy={$submitting}
    >
      <fieldset class="flow">
        <legend>New league</legend>
        <div class="field">
          <label for="name">League name</label>
          <input
            id="name"
            name="name"
            type="text"
            autocomplete="off"
            placeholder="My league"
            aria-invalid={$errors.name ? "true" : undefined}
            aria-describedby={$errors.name ? "name-error" : undefined}
            bind:value={$form.name}
          />
          {#if $errors.name}
            <p id="name-error" class="field-error">{$errors.name}</p>
          {/if}
        </div>

        <div class="field">
          <label for="description">Description <span class="optional">(optional)</span></label>
          <textarea
            id="description"
            name="description"
            rows="2"
            placeholder="What's this league about?"
            aria-invalid={$errors.description ? "true" : undefined}
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
      </fieldset>

      <button type="submit" class="submit-button" disabled={$submitting}>
        {$submitting ? "Creating…" : "Create league"}
      </button>
    </form>
  {/if}
</section>

<style>
  .leagues {
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

  fieldset {
    border: none;
    padding: 0;
    margin: 0;
  }

  legend {
    font-weight: var(--font-weight-7);
    padding: 0;
    margin-block-end: var(--size-2);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  .optional {
    color: var(--color-text-muted);
    font-weight: var(--font-weight-4);
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

  .create-toggle {
    margin-block-start: var(--size-2);
  }

  .reveal-button {
    align-self: start;
    padding: var(--size-2) var(--size-4);
    border: var(--border-size-1) solid var(--color-accent);
    border-radius: var(--radius-2);
    background: none;
    color: var(--color-text);
    font-weight: var(--font-weight-7);
    cursor: pointer;
    min-block-size: 44px;
  }

  .reveal-button:hover {
    color: var(--color-accent);
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

  .league-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  .league-row {
    display: flex;
    align-items: center;
    gap: var(--size-3);
    padding: var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
  }

  .league-name {
    font-weight: var(--font-weight-7);
  }
</style>
