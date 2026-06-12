import type { MiddlewareHandler } from "hono";

import { clerkMiddleware, getAuth } from "@hono/clerk-auth";

import type { CloudflareBindings } from "../platform";

import { getClerkKeys } from "../lib/auth/clerk-keys";

/**
 * The studio error envelope returned for an unauthenticated request to a
 * protected route.
 */
export const UNAUTHORIZED_ERROR = {
  error: {
    code: "unauthorized",
    message: "Authentication required.",
  },
} as const;

/**
 * Clerk request-authentication middleware, sourcing the keys from the Worker
 * runtime env per request.
 *
 * The keys are read inside the handler because the Cloudflare binding env is
 * only available per request, not at module load. The publishable key uses the
 * `PUBLIC_`-prefixed var name (via {@link getClerkKeys}), so the keys are passed
 * explicitly rather than relying on `@hono/clerk-auth`'s default env lookup.
 *
 * Verifies the Clerk session and attaches the Clerk identity to the request
 * context for downstream handlers (and {@link requireAuth}).
 */
export const clerkAuth: MiddlewareHandler<{
  Bindings: CloudflareBindings;
}> = (context, next) => {
  const { publishableKey, secretKey } = getClerkKeys(context.env);

  return clerkMiddleware({ publishableKey, secretKey })(context, next);
};

/**
 * Rejects requests that do not carry a verified Clerk session.
 *
 * Must run after {@link clerkAuth} (which populates the Clerk auth on the
 * context). A guest request (no `userId`) gets a 401 with the studio error
 * shape; otherwise the verified Clerk identity is available to downstream
 * handlers via `getAuth(context)`.
 */
export const requireAuth: MiddlewareHandler = async (context, next) => {
  const auth = getAuth(context);

  if (!auth?.userId) {
    return context.json(UNAUTHORIZED_ERROR, 401);
  }

  await next();
};
