<script lang="ts">
  import { SignIn } from "svelte-clerk";

  let { data } = $props();
</script>

<svelte:head>
  <title>Sign in · rankings.trade</title>
</svelte:head>

<main class="sign-in wrapper">
  <SignIn
    routing="path"
    path="/sign-in"
    signUpUrl="/sign-in"
    fallbackRedirectUrl={data.redirectTo}
  />
</main>

<style>
  .sign-in {
    display: flex;
    justify-content: center;
    padding-block: var(--size-8);
  }
</style>
