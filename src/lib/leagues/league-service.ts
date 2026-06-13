/**
 * League service: the tested logic layer behind the league management UI.
 * Composes league persistence (`db/leagues.ts`) and membership reads
 * (`db/league-members.ts`) with the authorization rules from the Epic E design.
 *
 * Authorization model:
 * - **Management** (create handled separately; rename/visibility/description, and
 *   — in later cards — participants and invites) requires the actor to be the
 *   league owner or an admin. Unknown leagues and leagues the actor may not
 *   manage collapse to a single `not_found` result so callers cannot enumerate
 *   or act on leagues they do not control (IDOR-safe).
 * - **Read**: public leagues are visible to anyone (including anonymous callers);
 *   a private league is visible only to its owner, an admin, or a user who owns
 *   an active member agent. Unauthorized private reads return `not_found` with no
 *   existence leak.
 *
 * Admin status is resolved by the caller (via `isAdmin()` over the env allowlist)
 * and passed in as {@link Actor.isAdmin}, keeping this layer free of env coupling.
 */

import type { League, LeagueUpdate, Visibility } from "../db/leagues";

import { userOwnsActiveMember } from "../db/league-members";
import {
  createLeague as createLeagueRow,
  getLeagueById,
  isValidLeagueName,
  updateLeague as updateLeagueRow,
} from "../db/leagues";

/** The acting user for a league operation. */
export type Actor = {
  /** Local `users.id` of the signed-in caller. */
  userId: number;
  /** Whether the caller is an admin (resolved via the env allowlist). */
  isAdmin: boolean;
};

/** Discriminated result for league-management operations. */
export type LeagueServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "invalid_name" | "not_found" };

/** Fields accepted by {@link createLeagueForActor}. */
export type CreateLeagueFields = {
  name: string;
  description?: string | null;
  visibility?: Visibility;
};

/**
 * Resolve a league and confirm the actor may manage it (owner or admin).
 *
 * Returns `not_found` for both unknown leagues and leagues the actor neither
 * owns nor admins, deliberately indistinguishable to prevent enumeration.
 */
async function requireManageableLeague(
  db: D1Database,
  actor: Actor,
  leagueId: number,
): Promise<{ league: League; ok: true } | { ok: false }> {
  const league = await getLeagueById(db, leagueId);
  if (!league) return { ok: false };
  if (actor.isAdmin || league.owner_user_id === actor.userId) {
    return { league, ok: true };
  }
  return { ok: false };
}

/**
 * Create a league owned by the actor. New leagues are private by default.
 */
export async function createLeagueForActor(
  db: D1Database,
  actor: Actor,
  fields: CreateLeagueFields,
): Promise<LeagueServiceResult<League>> {
  const name = fields.name.trim();
  if (!isValidLeagueName(name)) return { ok: false, reason: "invalid_name" };

  const league = await createLeagueRow(db, {
    name,
    description: fields.description ?? null,
    owner_user_id: actor.userId,
    visibility: fields.visibility ?? "private",
  });
  return { ok: true, value: league };
}

/**
 * Read a league subject to visibility rules.
 *
 * @param actor The signed-in caller, or null for an anonymous request.
 * @returns The league when viewable, else `not_found` (no existence leak for
 *   private leagues).
 */
export async function getViewableLeague(
  db: D1Database,
  actor: Actor | null,
  leagueId: number,
): Promise<LeagueServiceResult<League>> {
  const league = await getLeagueById(db, leagueId);
  if (!league) return { ok: false, reason: "not_found" };
  if (league.visibility === "public") return { ok: true, value: league };

  // Private: owner, admin, or owner of an active member agent.
  if (actor) {
    if (actor.isAdmin || league.owner_user_id === actor.userId) {
      return { ok: true, value: league };
    }
    if (await userOwnsActiveMember(db, leagueId, actor.userId)) {
      return { ok: true, value: league };
    }
  }
  return { ok: false, reason: "not_found" };
}

/**
 * Update a league's name, description, and/or visibility. Requires the actor to
 * own the league or be an admin. Omitted fields are left unchanged; pass
 * `description: null` to clear it.
 */
export async function updateLeagueDetails(
  db: D1Database,
  actor: Actor,
  leagueId: number,
  fields: LeagueUpdate,
): Promise<LeagueServiceResult<League>> {
  if (fields.name !== undefined && !isValidLeagueName(fields.name)) {
    return { ok: false, reason: "invalid_name" };
  }

  const manageable = await requireManageableLeague(db, actor, leagueId);
  if (!manageable.ok) return { ok: false, reason: "not_found" };

  const updated = await updateLeagueRow(db, leagueId, fields);
  if (!updated) return { ok: false, reason: "not_found" };
  return { ok: true, value: updated };
}
