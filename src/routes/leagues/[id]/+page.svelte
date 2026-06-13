<script lang="ts">
  import { enhance as formEnhance } from "$app/forms";
  import { superForm } from "sveltekit-superforms";

  import CreditsChart from "../../../lib/components/credits-chart.svelte";

  let { data, form: action } = $props();

  const { enhance, errors, form, message, submitting } = superForm(data.form);

  const addError = $derived(
    action?.action === "addParticipant" && "error" in action
      ? action.error
      : undefined,
  );

  const newJoinUrl = $derived(
    (action?.action === "createInvite" || action?.action === "rotateInvite") &&
      "joinUrl" in action
      ? action.joinUrl
      : undefined,
  );

  const activeInvites = $derived(
    data.invites.filter((invite) => invite.revoked_at === null),
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

  <section class="standings flow">
    <h2>Standings</h2>
    {#if data.standings.length === 0}
      <p class="empty">No finalized rounds yet.</p>
    {:else}
      {#if data.standingsRound}
        <p class="muted">Latest finalized round: {data.standingsRound}</p>
      {/if}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" class="num">#</th>
              <th scope="col">Agent</th>
              <th scope="col" class="num">Credits</th>
            </tr>
          </thead>
          <tbody>
            {#each data.standings as row (row.symbol)}
              <tr class:inactive={!row.participated}>
                <td class="num">{row.rank}</td>
                <td>
                  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic public profile route -->
                  <a class="callsign" href={`/u/${row.symbol}`}>{row.symbol}</a>
                </td>
                <td class="num">
                  {row.credits === null ? "—" : row.credits.toLocaleString("en-US")}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="graph flow">
    <h2>Credits over time</h2>
    <CreditsChart chart={data.chart} caption="Participant credits over time" />
  </section>

  <section class="activity flow">
    <h2>Activity</h2>
    {#if data.activity.length === 0}
      <p class="empty">No milestones or logs yet.</p>
    {:else}
      <ul class="feed">
        {#each data.activity as item, i (i)}
          <li class="feed-item">
            <div class="feed-head">
              <span class="callsign">{item.symbol}</span>
              {#if item.kind === "milestone"}
                <span class="feed-label">{item.label}</span>
                {#if item.recognized}
                  <span class="badge badge-recognized">Recognized</span>
                {:else}
                  <span class="badge badge-generic">Generic</span>
                {/if}
              {:else}
                <span class="badge badge-log">Log</span>
              {/if}
              <time class="muted">{item.ts}</time>
            </div>
            {#if item.kind === "milestone" && item.fields.length > 0}
              <dl class="fields">
                {#each item.fields as field (field.key)}
                  <div><dt>{field.key}</dt><dd>{field.value}</dd></div>
                {/each}
              </dl>
            {:else if item.kind === "log"}
              <p class="log-text">{item.text}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

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

    <section class="invites flow">
      <h2>Join link</h2>
      <p class="lede">
        Share a reusable link so people can join with their own agents. Revoke or
        rotate it at any time to invalidate the old URL.
      </p>

      {#if newJoinUrl}
        <div class="secret" role="status">
          <p class="secret-label">Shareable join link — copy it now:</p>
          <code class="secret-value">{newJoinUrl}</code>
        </div>
      {/if}

      <div class="invite-actions">
        <form method="POST" action="?/createInvite" use:formEnhance>
          <button type="submit" class="submit-button">Create join link</button>
        </form>
        {#if activeInvites.length > 0}
          <form method="POST" action="?/rotateInvite" use:formEnhance>
            <button type="submit" class="secondary-button">Rotate</button>
          </form>
        {/if}
      </div>

      {#if activeInvites.length === 0}
        <p class="empty">No active join link.</p>
      {:else}
        <ul class="invite-list">
          {#each activeInvites as invite (invite.id)}
            <li class="invite-row">
              <code class="invite-prefix">{invite.token_prefix}…</code>
              <form method="POST" action="?/revokeInvite" use:formEnhance>
                <input type="hidden" name="inviteId" value={invite.id} />
                <button type="submit" class="remove-button">Revoke</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
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

  .standings,
  .graph,
  .activity {
    margin-block-start: var(--size-6);
  }

  .muted {
    color: var(--color-text-muted);
    font-size: var(--font-size-0);
  }

  .table-scroll {
    overflow-x: auto;
  }

  table {
    inline-size: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    text-align: start;
    padding: var(--size-2) var(--size-3);
    border-block-end: var(--border-size-1) solid var(--color-surface);
  }

  .num {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }

  .callsign {
    font-family: var(--font-mono, monospace);
    font-weight: var(--font-weight-7);
  }

  tr.inactive {
    opacity: 0.6;
  }

  .feed {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  .feed-item {
    padding: var(--size-2) var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
  }

  .feed-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-2);
  }

  .feed-label {
    font-weight: var(--font-weight-7);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--size-3);
    margin: var(--size-2) 0 0;
    font-size: var(--font-size-0);
  }

  .fields dt {
    color: var(--color-text-muted);
  }

  .fields dd {
    margin: 0;
    font-family: var(--font-mono, monospace);
  }

  .log-text {
    margin: var(--size-1) 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .badge-recognized {
    background: var(--color-link);
    color: var(--color-background);
  }

  .badge-generic,
  .badge-log {
    background: var(--color-surface);
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

  .invites {
    margin-block-start: var(--size-6);
    padding-block-start: var(--size-4);
    border-block-start: var(--border-size-1) solid var(--color-surface);
  }

  .lede {
    color: var(--color-text-muted);
  }

  .secret {
    padding: var(--size-3);
    border: var(--border-size-1) solid var(--color-link);
    border-radius: var(--radius-2);
  }

  .secret-label {
    margin: 0 0 var(--size-2);
    font-weight: var(--font-weight-7);
  }

  .secret-value {
    word-break: break-all;
    font-family: var(--font-mono, monospace);
  }

  .invite-actions {
    display: flex;
    gap: var(--size-2);
    margin-block: var(--size-3);
  }

  .invite-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2);
  }

  .invite-row {
    display: flex;
    align-items: center;
    gap: var(--size-3);
    padding: var(--size-2) var(--size-3);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
  }

  .invite-prefix {
    font-family: var(--font-mono, monospace);
  }

  .secondary-button {
    padding: var(--size-2) var(--size-4);
    border: var(--border-size-1) solid var(--color-surface);
    border-radius: var(--radius-2);
    background: var(--color-background);
    color: var(--color-text);
    font-weight: var(--font-weight-7);
    cursor: pointer;
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
