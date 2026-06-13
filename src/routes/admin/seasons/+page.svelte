<script lang="ts">
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const openSeason = $derived(data.seasons.find((s) => s.closed_at === null) ?? null);
</script>

<svelte:head>
  <title>Admin · Seasons</title>
</svelte:head>

<section>
  <h1>Seasons</h1>

  {#if form?.created}
    <p class="success">Opened season “{form.created.label}” (#{form.created.id}).</p>
  {/if}
  {#if form?.updated}
    <p class="success">Updated season “{form.updated.label}” (#{form.updated.id}).</p>
  {/if}
  {#if form?.error}
    <p class="error">{form.error}</p>
  {/if}

  {#if openSeason}
    <h2>Open season — {openSeason.label}</h2>
    <p>
      Cutoff {openSeason.cutoff_date} · unranked gap {openSeason.unranked_gap_days} day(s)
    </p>
    <form method="POST" action="?/update">
      <input type="hidden" name="id" value={openSeason.id} />
      <label>
        Cutoff date (YYYY-MM-DD)
        <input name="cutoff_date" value={openSeason.cutoff_date} />
      </label>
      <label>
        Unranked gap (days)
        <input name="unranked_gap_days" type="number" min="0" value={openSeason.unranked_gap_days} />
      </label>
      <button type="submit">Update open season</button>
    </form>
  {:else}
    <h2>Open a new season</h2>
    <form method="POST" action="?/create">
      <label>
        Label
        <input name="label" required />
      </label>
      <label>
        Cutoff date (YYYY-MM-DD)
        <input name="cutoff_date" required placeholder="2026-09-01" />
      </label>
      <label>
        Unranked gap (days)
        <input name="unranked_gap_days" type="number" min="0" value="0" />
      </label>
      <button type="submit">Open season</button>
    </form>
  {/if}

  <h2>All seasons</h2>
  {#if data.seasons.length === 0}
    <p>No seasons yet.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Label</th>
          <th>Cutoff</th>
          <th>Gap</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {#each data.seasons as season (season.id)}
          <tr>
            <td>{season.id}</td>
            <td>{season.label}</td>
            <td>{season.cutoff_date}</td>
            <td>{season.unranked_gap_days}</td>
            <td>{season.closed_at === null ? "open" : `closed ${season.closed_at}`}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
