import type { AdminEnv } from "../auth/admin";
import type { User } from "../db/users";
import type { Actor } from "./league-service";

import { isAdmin } from "../auth/admin";

/**
 * Resolve the {@link Actor} for a league request from the SvelteKit locals.
 *
 * Returns null for anonymous requests (no resolved local user). Admin status is
 * derived from the Clerk user id against the env allowlist, so the service layer
 * stays free of env coupling.
 *
 * @param user - The resolved local user (`locals.user`), or null when anonymous.
 * @param clerkUserId - The Clerk user id (`locals.userId`), or null.
 * @param env - The Worker env carrying the admin allowlist.
 */
export function resolveActor(
  user: null | User,
  clerkUserId: null | string,
  env: AdminEnv,
): Actor | null {
  if (!user) return null;
  return { userId: user.id, isAdmin: isAdmin(clerkUserId, env) };
}
