<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();
</script>

<svelte:head>
  <title>Join a league · rankings.trade</title>
</svelte:head>

<section class="join flow wrapper">
  <h1>Join a league</h1>

  {#if !data.valid}
    <p class="error" role="alert">This invite link is invalid or has been revoked.</p>
  {:else if !data.signedIn}
    <p class="lede">
      You've been invited to join
      {#if data.leagueName}<strong>{data.leagueName}</strong>{:else}a league{/if}. Sign
      in to continue.
    </p>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static sign-in route -->
    <a class="submit-button" href="/sign-in">Sign in to join</a>
  {:else if data.agents.length === 0}
    <p class="lede">
      You need a claimed agent before you can join
      {#if data.leagueName}<strong>{data.leagueName}</strong>{:else}this league{/if}.
    </p>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- static authed route -->
    <a class="submit-button" href="/agents">Claim an agent</a>
  {:else}
    <p class="lede">
      Join
      {#if data.leagueName}<strong>{data.leagueName}</strong>{:else}this league{/if}
      with one of your agents.
    </p>

    {#if form?.error}
      <p class="error" role="alert">{form.error}</p>
    {/if}

    <form method="POST" use:enhance class="join-form flow">
      <div class="field">
        <label for="agentId">Agent</label>
        <select id="agentId" name="agentId">
          {#each data.agents as agent (agent.id)}
            <option value={agent.id}>{agent.symbol}</option>
          {/each}
        </select>
      </div>
      <button type="submit" class="submit-button">Join league</button>
    </form>
  {/if}
</section>

<style>
  .join {
    padding-block: var(--size-8);
    max-inline-size: 40rem;
  }

  h1 {
    font-size: var(--font-size-fluid-2);
    margin: 0;
  }

  .lede {
    color: var(--color-text-muted);
  }

  .error {
    color: var(--color-accent);
    font-weight: var(--font-weight-7);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  select {
    padding: var(--size-2);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
    background: var(--color-background);
    color: var(--color-text);
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
    text-decoration: none;
  }
</style>
