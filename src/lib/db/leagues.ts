/**
 * Typed query helpers for the `leagues` table.
 *
 * Leagues are private by default and owned by their creating user
 * (`owner_user_id` is the local `users.id`). Names are validated before they
 * touch the database. Forward-only pattern: no schema mutations here, only DML.
 */

/** Inclusive bounds for a league name. */
const NAME_MIN = 1;
const NAME_MAX = 80;

/** Configurable league visibility. New leagues default to `private`. */
export type Visibility = "private" | "public";

/** Full league record as stored in the database. */
export type League = {
  id: number;
  name: string;
  description: string | null;
  visibility: Visibility;
  owner_user_id: number;
  created_at: string;
  updated_at: string;
};

/** Fields for {@link createLeague}. */
export type CreateLeagueInput = {
  name: string;
  owner_user_id: number;
  description?: string | null;
  visibility?: Visibility;
};

/** Mutable league fields; omit a key to leave it unchanged. */
export type LeagueUpdate = {
  name?: string;
  description?: string | null;
  visibility?: Visibility;
};

/** True when `name` is within the allowed length bounds after trimming. */
export function isValidLeagueName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;
}

/**
 * Retrieve a league by its primary key.
 *
 * @returns The matching league, or null if none exists.
 */
export async function getLeagueById(
  db: D1Database,
  id: number,
): Promise<League | null> {
  const result = await db
    .prepare("SELECT * FROM leagues WHERE id = ?")
    .bind(id)
    .first<League>();
  return result ?? null;
}

/**
 * List the leagues owned by a given user, newest first.
 */
export async function listLeaguesByOwner(
  db: D1Database,
  ownerUserId: number,
): Promise<League[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM leagues WHERE owner_user_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(ownerUserId)
    .all<League>();
  return results ?? [];
}

/**
 * List every public league, newest first.
 */
export async function listPublicLeagues(db: D1Database): Promise<League[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM leagues WHERE visibility = 'public' ORDER BY created_at DESC, id DESC",
    )
    .all<League>();
  return results ?? [];
}

/**
 * Create a league owned by `owner_user_id`. Visibility defaults to `private`.
 *
 * @throws If the name is invalid (empty or too long) after trimming.
 */
export async function createLeague(
  db: D1Database,
  input: CreateLeagueInput,
): Promise<League> {
  const name = input.name.trim();
  if (!isValidLeagueName(name)) {
    throw new Error(`createLeague: name must be ${NAME_MIN}-${NAME_MAX} chars`);
  }

  const created = await db
    .prepare(
      `INSERT INTO leagues (name, description, visibility, owner_user_id)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(
      name,
      input.description ?? null,
      input.visibility ?? "private",
      input.owner_user_id,
    )
    .first<League>();

  if (!created) {
    throw new Error("createLeague: record not found after write");
  }
  return created;
}

/**
 * Apply a partial update to a league (name / description / visibility) and bump
 * `updated_at`. Keys omitted from `fields` are left unchanged; pass
 * `description: null` to clear the description.
 *
 * @returns The updated league, or null if no league has that id. When `fields`
 *   contains no updatable keys the league is returned unchanged.
 * @throws If `name` is provided but invalid.
 */
export async function updateLeague(
  db: D1Database,
  id: number,
  fields: LeagueUpdate,
): Promise<League | null> {
  const assignments: string[] = [];
  const bindings: unknown[] = [];

  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (!isValidLeagueName(name)) {
      throw new Error(`updateLeague: name must be ${NAME_MIN}-${NAME_MAX} chars`);
    }
    assignments.push("name = ?");
    bindings.push(name);
  }
  if (fields.description !== undefined) {
    assignments.push("description = ?");
    bindings.push(fields.description);
  }
  if (fields.visibility !== undefined) {
    assignments.push("visibility = ?");
    bindings.push(fields.visibility);
  }

  if (assignments.length === 0) {
    return getLeagueById(db, id);
  }

  assignments.push("updated_at = CURRENT_TIMESTAMP");
  bindings.push(id);

  await db
    .prepare(`UPDATE leagues SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...bindings)
    .run();

  return getLeagueById(db, id);
}
