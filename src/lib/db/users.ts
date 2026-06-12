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
  const email = input.email ?? null;
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
