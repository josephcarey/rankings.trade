import type { Handle } from "@sveltejs/kit";

import type { User } from "../db/users";
import type { ClerkUserLike } from "./clerk-identity";

import { provisionUser } from "../db/users";
import { clerkIdentity } from "./clerk-identity";

/**
 * Provisions (or refreshes) the local user row for a Clerk identity and returns
 * the resolved local user.
 *
 * The Clerk user is supplied by a caller-provided thunk so this stays testable
 * without a live Clerk client; the same helper backs both the SvelteKit hook
 * and the Hono middleware so provisioning behavior is identical in both layers.
 *
 * @param db - The D1 database.
 * @param fetchClerkUser - Resolves the current Clerk user.
 * @returns The provisioned local user.
 */
export async function resolveLocalUser(
  db: D1Database,
  fetchClerkUser: () => Promise<ClerkUserLike>,
): Promise<User> {
  const clerkUser = await fetchClerkUser();
  return provisionUser(db, clerkIdentity(clerkUser));
}

/**
 * Dependencies for {@link createLocalUserHandle}, injected so the hook's
 * orchestration is unit-testable with fakes.
 */
export type LocalUserHandleDeps = {
  fetchClerkUser: (
    event: Parameters<Handle>[0]["event"],
    userId: string,
  ) => Promise<ClerkUserLike>;
  getDb: (
    event: Parameters<Handle>[0]["event"],
  ) => D1Database | undefined;
};

/**
 * Builds the SvelteKit hook that attaches the resolved local user to
 * `event.locals.user` on authenticated, non-API page requests.
 *
 * `/api` requests are skipped because the Hono layer owns API-side provisioning
 * (avoids double-provisioning the same request). `locals.user` is always
 * initialized to `null` so downstream loads never observe `undefined`.
 *
 * @param deps - The Clerk-user fetcher and DB accessor.
 * @returns A SvelteKit `Handle`.
 */
export function createLocalUserHandle(deps: LocalUserHandleDeps): Handle {
  return async ({ event, resolve }) => {
    event.locals.user = null;

    const { userId } = event.locals;
    if (userId && !event.url.pathname.startsWith("/api")) {
      const db = deps.getDb(event);
      if (db) {
        event.locals.user = await resolveLocalUser(db, () =>
          deps.fetchClerkUser(event, userId),
        );
      }
    }

    return resolve(event);
  };
}
