import { buildClerkProps } from "svelte-clerk/server";

import type { LayoutServerLoad } from "./$types";

import { toNavState } from "../lib/auth/nav";

/**
 * Surfaces the Clerk SSR state (for `<ClerkProvider>`) and the derived nav auth
 * state to every page. Runs on each request after the Clerk session hook
 * (card #15) has populated `locals`.
 */
export const load: LayoutServerLoad = ({ locals }) => ({
  ...buildClerkProps(locals.auth()),
  nav: toNavState(locals),
});
