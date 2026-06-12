import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

import { safeRedirectTarget } from "../../../lib/auth/redirect";

/**
 * Sign-in route load (covers `/sign-in` and Clerk's path-routed subpaths such
 * as `/sign-in/sso-callback`).
 *
 * Computes the sanitized post-sign-in destination from the `redirect_url` query
 * param. If the request is already authenticated — including the state after
 * Clerk completes magic-link verification and the session cookie is set — it
 * redirects off the sign-in flow to that destination. Guests stay on the page
 * and the destination is handed to the `<SignIn>` component as its fallback
 * redirect.
 */
export const load: PageServerLoad = ({ locals, url }) => {
  const redirectTo = safeRedirectTarget(url.searchParams.get("redirect_url"));

  if (locals.userId) {
    redirect(303, redirectTo);
  }

  return { redirectTo };
};
