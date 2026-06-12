import type { Handle } from "@sveltejs/kit";

import { redirect } from "@sveltejs/kit";

const SIGN_IN_PATH = "/sign-in";

/**
 * Path prefixes that require an authenticated session. Everything not matched
 * here is public (home, leaderboard, public profiles, sign-in, callbacks).
 *
 * `/settings` is the authed profile area consumed by cards B5/B6 (#12/#13).
 */
const AUTHED_PREFIXES = ["/settings"] as const;

/**
 * Classifies whether a request path requires authentication.
 *
 * Pure and server-evaluated so the guard never depends on client state. A path
 * is authed when it equals an authed prefix or sits beneath it (so `/settings`
 * and `/settings/anything` are both protected); all other paths are public.
 *
 * @param pathname - The request URL pathname (no query string).
 * @returns `true` when the path is behind authentication.
 */
export function requiresAuth(pathname: string): boolean {
  return AUTHED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Builds the sign-in redirect location for an unauthenticated request to an
 * authed path, preserving the intended destination (path + query) as the
 * `redirect_url` param that the sign-in route reads.
 *
 * @param pathname - The intended destination pathname.
 * @param search - The intended destination query string (including leading `?`), if any.
 * @returns A relative sign-in URL, e.g. `/sign-in?redirect_url=%2Fsettings`.
 */
export function signInRedirect(pathname: string, search = ""): string {
  const target = encodeURIComponent(`${pathname}${search}`);

  return `${SIGN_IN_PATH}?redirect_url=${target}`;
}

/**
 * Server-side route guard: redirects unauthenticated requests for authed paths
 * to the sign-in page (preserving the intended destination), and lets public
 * paths and already-authenticated requests through untouched.
 *
 * Runs in the SvelteKit hooks sequence after the Clerk session handle (which
 * populates `locals.userId`). Gating server-side means protected content never
 * flashes client-side.
 */
export const requireAuthHandle: Handle = ({ event, resolve }) => {
  if (requiresAuth(event.url.pathname) && !event.locals.userId) {
    redirect(302, signInRedirect(event.url.pathname, event.url.search));
  }

  return resolve(event);
};
