<script lang="ts">
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>Admin · Transfer {data.agent.symbol}</title>
</svelte:head>

<section>
  <h1>Transfer ownership — {data.agent.symbol}</h1>
  <p>Current owner user id: {data.agent.owner_user_id ?? "unclaimed"}</p>

  {#if form?.transferred}
    <p class="success">
      Transferred {form.transferred.symbol} to user {form.transferred.newOwnerUserId}. Revoked
      {form.transferred.revokedTokens} prior token(s).
    </p>
  {/if}

  {#if form?.error}
    <p class="error">{form.error}</p>
  {/if}

  <form method="POST" action="?/transfer">
    <label>
      New owner Clerk user id
      <input name="newOwnerClerkId" required />
    </label>
    <label>
      Reason (optional)
      <textarea name="reason" maxlength="500"></textarea>
    </label>
    <button type="submit">Transfer ownership</button>
  </form>
</section>
