/**
 * Typed query helpers for the `users` table.
 *
 * All records are keyed on `clerk_user_id` — a Clerk-issued user identifier.
 * `visibility` is stored here so public-profile readers (Epic J) can filter
 * on it without touching this module.
 *
 * Forward-only pattern: no schema mutations here, only DML.
 */

/** Profile visibility mode stored on every user record. */
export type Visibility = "private" | "public";

/** Full user record as stored in the database. */
export type User = {
  id: number;
  clerk_user_id: string;
  email: string | null;
  display_name: string | null;
  visibility: Visibility;
  dashboard_url: string | null;
  created_at: string;
  updated_at: string;
};

/** Input for creating or provisioning a user record. */
export type UpsertUserInput = {
  clerk_user_id: string;
  dashboard_url?: string | null;
  display_name?: string | null;
  email?: string | null;
  visibility?: Visibility;
};

/**
 * Clerk-sourced identity fields for provisioning.
 *
 * Unlike {@link UpsertUserInput}, the Clerk-mutable fields are required (and
 * nullable, never `undefined`) so a provisioning call always states the current
 * Clerk identity explicitly and never accidentally binds `undefined`.
 */
export type ProvisionUserInput = {
  clerk_user_id: string;
  display_name: string | null;
  email: string | null;
  /**
   * Whether Clerk reports the primary email as verified. The duplicate-by-email
   * re-link in {@link provisionUser} only fires for a VERIFIED email — an
   * unverified address must never be allowed to re-link (take over) an existing
   * account. Unverified callers fall through to INSERT, where the `email`
   * unique index (migration 0019) rejects a genuine duplicate loudly.
   */
  email_verified: boolean;
};

/**
 * Fields that a user can update from their profile settings page.
 * Omitting a field leaves it unchanged.
 */
export type UpdateProfileInput = {
  dashboard_url?: string | null;
  display_name?: string | null;
  visibility?: Visibility;
};

/**
 * Retrieve a user record by Clerk user ID.
 *
 * @param db D1 database instance
 * @param clerkUserId Clerk-issued user identifier
 * @returns The matching user record, or null if not found
 */
export async function getUserByClerkId(
  db: D1Database,
  clerkUserId: string,
): Promise<User | null> {
  const result = await db
    .prepare("SELECT * FROM users WHERE clerk_user_id = ?")
    .bind(clerkUserId)
    .first<User>();
  return result ?? null;
}

/**
 * Normalize an email for storage and comparison: trim surrounding whitespace and
 * lowercase it. Returns null for null/empty input. Keeping every write and lookup
 * normalized makes the email re-link guard and the `email` unique index
 * (migration 0019, a `lower(email)` expression index) robust to case — so
 * `Joe@x` and `joe@x` collapse to one account instead of bypassing both.
 */
function normalizeEmail(email: string | null): string | null {
  if (email === null) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * Retrieve a user record by email, preferring the NEWEST matching row
 * (`ORDER BY id DESC`). Newest-first matters during the window between deploying
 * this guard and running the manual user merge: while a duplicate still exists,
 * the canonical row is the higher id (e.g. id 10, not the stale id 1), so a
 * re-auth in that window re-links onto the canonical row rather than reviving the
 * row the merge is about to delete. Email is normalized before comparison so the
 * match is case-insensitive. Null/empty emails never match.
 *
 * @param db D1 database instance
 * @param email Email address to look up
 * @returns The matching user record, or null if none / email is null
 */
async function getUserByEmail(
  db: D1Database,
  email: string | null,
): Promise<User | null> {
  const normalized = normalizeEmail(email);
  if (normalized === null) return null;
  const result = await db
    .prepare("SELECT * FROM users WHERE email = ? ORDER BY id DESC LIMIT 1")
    .bind(normalized)
    .first<User>();
  return result ?? null;
}

/**
 * Insert or update a user record keyed on `clerk_user_id`.
 *
 * On conflict (same `clerk_user_id`) the email, display_name, visibility,
 * dashboard_url, and updated_at columns are overwritten.
 *
 * @param db D1 database instance
 * @param input User fields to persist
 * @returns The resulting (inserted or updated) user record
 * @throws If the database write fails (e.g. CHECK constraint violation)
 */
export async function upsertUser(
  db: D1Database,
  input: UpsertUserInput,
): Promise<User> {
  const clerkUserId = input.clerk_user_id;
  const email = normalizeEmail(input.email ?? null);
  const displayName = input.display_name ?? null;
  const visibility = input.visibility ?? "public";
  const dashboardUrl = input.dashboard_url ?? null;

  await db
    .prepare(
      `INSERT INTO users (clerk_user_id, email, display_name, visibility, dashboard_url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(clerk_user_id) DO UPDATE SET
         email         = excluded.email,
         display_name  = excluded.display_name,
         visibility    = excluded.visibility,
         dashboard_url = excluded.dashboard_url,
         updated_at    = CURRENT_TIMESTAMP`,
    )
    .bind(clerkUserId, email, displayName, visibility, dashboardUrl)
    .run();

  const user = await getUserByClerkId(db, clerkUserId);
  if (!user) {
    throw new Error(`upsertUser: record not found after write (${clerkUserId})`);
  }
  return user;
}

/**
 * Provision (insert-or-refresh) a user record from the current Clerk identity.
 *
 * Idempotent and keyed on `clerk_user_id`. On first sight the row is created
 * with the schema defaults for the local-only fields (`visibility` = `public`,
 * `dashboard_url` = `null`). On a repeat authenticated request the
 * Clerk-sourced fields (`email`, `display_name`) are refreshed, while the
 * local-only fields the user controls (`visibility`, `dashboard_url`) are
 * **preserved** — this is the key difference from {@link upsertUser}, which
 * overwrites them.
 *
 * **Duplicate-by-email guard:** when no row matches `clerk_user_id` but a row
 * already exists for the same (non-null) `email`, that row is RE-LINKED to the
 * new `clerk_user_id` (and its Clerk fields refreshed) instead of inserting a
 * second row. This prevents the duplicate-email/different-clerk-id rows that
 * arise when a user re-authenticates under a fresh Clerk identity. The user's
 * local-only fields (`visibility`, `dashboard_url`) are preserved on re-link.
 *
 * **Account-takeover guard:** the re-link only fires when `email_verified` is
 * true. An unverified email must never re-link (and thereby seize) an existing
 * account; such callers fall through to INSERT, where the `email` unique index
 * (migration 0019) rejects a genuine duplicate loudly.
 *
 * @param db D1 database instance
 * @param input The current Clerk identity (id + mutable Clerk fields)
 * @returns The resulting (inserted, refreshed, or re-linked) user record
 * @throws If the record cannot be read back after the write
 */
export async function provisionUser(
  db: D1Database,
  input: ProvisionUserInput,
): Promise<User> {
  const email = normalizeEmail(input.email);

  // Re-link guard: a known, VERIFIED email under a NEW Clerk id updates the
  // existing row rather than creating a duplicate. Only applies when this Clerk
  // id is unseen and Clerk reports the email as verified.
  const existingByClerk = await getUserByClerkId(db, input.clerk_user_id);
  if (!existingByClerk && input.email_verified) {
    const existingByEmail = await getUserByEmail(db, email);
    if (existingByEmail) {
      await db
        .prepare(
          `UPDATE users
             SET clerk_user_id = ?,
                 email         = ?,
                 display_name  = ?,
                 updated_at    = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          input.clerk_user_id,
          email,
          input.display_name,
          existingByEmail.id,
        )
        .run();

      const relinked = await getUserByClerkId(db, input.clerk_user_id);
      if (!relinked) {
        throw new Error(
          `provisionUser: record not found after re-link (${input.clerk_user_id})`,
        );
      }
      return relinked;
    }
  }

  await db
    .prepare(
      `INSERT INTO users (clerk_user_id, email, display_name)
       VALUES (?, ?, ?)
       ON CONFLICT(clerk_user_id) DO UPDATE SET
         email        = excluded.email,
         display_name = excluded.display_name,
         updated_at   = CURRENT_TIMESTAMP`,
    )
    .bind(input.clerk_user_id, email, input.display_name)
    .run();

  const user = await getUserByClerkId(db, input.clerk_user_id);
  if (!user) {
    throw new Error(
      `provisionUser: record not found after write (${input.clerk_user_id})`,
    );
  }
  return user;
}

/**
 * Update profile-visible settings for an existing user.
 *
 * Only the fields present in `input` are written; omitted fields retain
 * their current database values.
 *
 * @param db D1 database instance
 * @param clerkUserId Clerk-issued user identifier
 * @param input Partial profile fields to update
 * @returns The updated user record, or null if the user was not found
 */
export async function updateUserProfile(
  db: D1Database,
  clerkUserId: string,
  input: UpdateProfileInput,
): Promise<User | null> {
  const existing = await getUserByClerkId(db, clerkUserId);
  if (!existing) return null;

  // Merge: provided fields win; omitted fields keep their existing values.
  const displayName =
    "display_name" in input ? (input.display_name ?? null) : existing.display_name;
  const visibility =
    input.visibility === undefined ? existing.visibility : input.visibility;
  const dashboardUrl =
    "dashboard_url" in input ? (input.dashboard_url ?? null) : existing.dashboard_url;

  await db
    .prepare(
      `UPDATE users
       SET display_name  = ?,
           visibility    = ?,
           dashboard_url = ?,
           updated_at    = CURRENT_TIMESTAMP
       WHERE clerk_user_id = ?`,
    )
    .bind(displayName, visibility, dashboardUrl, clerkUserId)
    .run();

  return getUserByClerkId(db, clerkUserId);
}
