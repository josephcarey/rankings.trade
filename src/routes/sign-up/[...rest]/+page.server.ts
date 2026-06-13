import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

import { safeRedirectTarget } from "../../../lib/auth/redirect";

/**
 * Sign-up route load (covers `/sign-up` and Clerk's path-routed subpaths such
 * as `/sign-up/verify-email-address` and `/sign-up/sso-callback`).
 *
 * Computes the sanitized post-sign-up destination from the `redirect_url` query
 * param. If the request is already authenticated — including the state after
 * Clerk completes verification and the session cookie is set — it redirects off
 * the sign-up flow to that destination. Guests stay on the page and the
 * destination is handed to the `<SignUp>` component as its fallback redirect.
 */
export const load: PageServerLoad = ({ locals, url }) => {
  const redirectTo = safeRedirectTarget(url.searchParams.get("redirect_url"));

  if (locals.userId) {
    redirect(303, redirectTo);
  }

  return { redirectTo };
};
