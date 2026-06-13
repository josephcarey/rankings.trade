<script lang="ts">
  import { SignUp } from "svelte-clerk";

  let { data } = $props();
</script>

<svelte:head>
  <title>Sign up · rankings.trade</title>
</svelte:head>

<main class="sign-up wrapper">
  <SignUp
    routing="path"
    path="/sign-up"
    signInUrl="/sign-in"
    fallbackRedirectUrl={data.redirectTo}
  />
</main>

<style>
  .sign-up {
    display: flex;
    justify-content: center;
    padding-block: var(--size-8);
  }
</style>
