import type { MiddlewareHandler } from "hono";

import { clerkMiddleware, getAuth } from "@hono/clerk-auth";

import type { ClerkUserLike } from "../lib/auth/clerk-identity";
import type { User } from "../lib/db/users";
import type { CloudflareBindings } from "../platform";

import { getClerkKeys } from "../lib/auth/clerk-keys";
import { resolveLocalUser } from "../lib/auth/local-user";

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

/**
 * Hono context variables an authed handler can read after the auth chain runs.
 */
export type AuthedVariables = {
  user: User;
};

/**
 * Dependencies for {@link createAttachLocalUser}, injected so the middleware's
 * orchestration is unit-testable with fakes.
 */
export type AttachLocalUserDeps = {
  fetchClerkUser: (
    context: Parameters<MiddlewareHandler>[0],
    userId: string,
  ) => Promise<ClerkUserLike>;
  getDb: (context: Parameters<MiddlewareHandler>[0]) => D1Database;
};

/**
 * Builds the middleware that provisions (or refreshes) the local user for the
 * verified Clerk identity and attaches it to the context as `user`.
 *
 * Must run after {@link requireAuth} (which guarantees a `userId`). Shares the
 * `resolveLocalUser` helper with the SvelteKit hook so provisioning behavior is
 * identical across layers.
 *
 * @param deps - The Clerk-user fetcher and DB accessor.
 */
export function createAttachLocalUser(
  deps: AttachLocalUserDeps,
): MiddlewareHandler<{
  Bindings: CloudflareBindings;
  Variables: AuthedVariables;
}> {
  return async (context, next) => {
    const userId = getAuth(context)?.userId;
    if (userId) {
      const user = await resolveLocalUser(deps.getDb(context), () =>
        deps.fetchClerkUser(context, userId),
      );
      context.set("user", user);
    }

    await next();
  };
}

/**
 * Default {@link createAttachLocalUser} wiring: the Clerk user comes from the
 * client `clerkMiddleware` attached to the context, the DB from the Worker env.
 */
export const attachLocalUser = createAttachLocalUser({
  fetchClerkUser: (context, userId) => context.get("clerk").users.getUser(userId),
  getDb: (context) => context.env.DB,
});
