import { buildClerkProps } from "svelte-clerk/server";

import type { LayoutServerLoad } from "./$types";

import { toNavState } from "../lib/auth/nav";
import { listLeaguesForUser } from "../lib/db/leagues";
import { parseThemeMode, THEME_COOKIE } from "../lib/theme";

/**
 * Surfaces the Clerk SSR state (for `<ClerkProvider>`) and the derived nav auth
 * state to every page. Runs on each request after the Clerk session hook
 * (card #15) has populated `locals`.
 *
 * When signed in, also loads the caller's leagues (owned ∪ enrolled) for the
 * nav's Leagues dropdown. This runs on every request, but it's a single batched
 * query and only fires for authenticated users.
 */
export const load: LayoutServerLoad = async ({ cookies, locals, platform }) => {
  const db = platform?.env.DB;
  const rows =
    locals.user && db ? await listLeaguesForUser(db, locals.user.id) : [];
  const leagues = rows.map(({ id, name }) => ({ id, name }));

  return {
    ...buildClerkProps(locals.auth()),
    nav: toNavState(locals),
    theme: parseThemeMode(cookies.get(THEME_COOKIE)),
    leagues,
  };
};
