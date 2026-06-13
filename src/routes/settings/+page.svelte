<script lang="ts">
  import { superForm } from "sveltekit-superforms";

  let { data } = $props();

  const { enhance, errors, form, message, submitting } = superForm(data.form);

  const clearDashboardUrl = () => {
    $form.dashboard_url = "";
  };
</script>

<svelte:head>
  <title>Profile settings · rankings.trade</title>
  <meta name="description" content="Manage your profile visibility and dashboard link." />
</svelte:head>

<main class="settings flow wrapper">
  <h1>Profile settings</h1>

  {#if $message}
    <p class="form-message" role="status">{$message}</p>
  {/if}

  <form method="POST" use:enhance class="flow" aria-busy={$submitting}>
    <fieldset class="flow">
      <legend>Visibility</legend>
      <label class="choice">
        <input type="radio" name="visibility" value="public" bind:group={$form.visibility} />
        Public — anyone can view your profile
      </label>
      <label class="choice">
        <input type="radio" name="visibility" value="private" bind:group={$form.visibility} />
        Private — only you can view your profile
      </label>
      {#if $errors.visibility}
        <p class="field-error">{$errors.visibility}</p>
      {/if}
    </fieldset>

    <div class="field flow">
      <label for="dashboard_url">Dashboard link</label>
      <div class="field-row">
        <input
          id="dashboard_url"
          name="dashboard_url"
          type="url"
          inputmode="url"
          placeholder="https://example.com/dashboard"
          aria-invalid={$errors.dashboard_url ? "true" : undefined}
          aria-describedby={$errors.dashboard_url ? "dashboard_url-error" : undefined}
          bind:value={$form.dashboard_url}
        />
        <button
          type="button"
          class="clear-button"
          onclick={clearDashboardUrl}
          disabled={!$form.dashboard_url}
        >
          Clear
        </button>
      </div>
      {#if $errors.dashboard_url}
        <p id="dashboard_url-error" class="field-error">{$errors.dashboard_url}</p>
      {/if}
    </div>

    <button type="submit" class="submit-button" disabled={$submitting}>
      {$submitting ? "Saving…" : "Save changes"}
    </button>
  </form>
</main>

<style>
  .settings {
    padding-block: var(--size-8);
    max-inline-size: 48rem;
  }

  h1 {
    font-size: var(--font-size-fluid-2);
    margin: 0;
  }

  fieldset {
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
    padding: var(--size-4);
  }

  legend {
    font-weight: var(--font-weight-7);
    padding-inline: var(--size-2);
  }

  .choice {
    display: flex;
    gap: var(--size-2);
    align-items: center;
  }

  .field-row {
    display: flex;
    gap: var(--size-2);
    align-items: center;
  }

  input[type="url"] {
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

  .clear-button {
    padding: var(--size-2) var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .clear-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
