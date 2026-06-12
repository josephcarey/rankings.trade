/**
 * Admin authorization: a signed-in Clerk user is an admin when their Clerk user
 * id is present in the comma-separated `ADMIN_CLERK_USER_IDS` env allowlist.
 *
 * There is no role table or role UI in v1 — admin status is purely env-derived
 * and fails closed: an unset/empty allowlist means nobody is an admin.
 */

/** Source of the admin allowlist (the Worker runtime env binding). */
export type AdminEnv = {
  ADMIN_CLERK_USER_IDS?: string;
};

/**
 * True when `clerkUserId` is an exact (case-sensitive) member of the allowlist.
 *
 * Matching is exact set membership — never substring — so a partial id can
 * never escalate. Whitespace is trimmed and empty segments are dropped.
 */
export function isAdmin(
  clerkUserId: null | string | undefined,
  env: AdminEnv,
): boolean {
  if (!clerkUserId) return false;

  const raw = env.ADMIN_CLERK_USER_IDS;
  if (!raw) return false;

  const allow = new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

  return allow.has(clerkUserId);
}
