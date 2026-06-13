/**
 * Milestone-type registry service: manage a league's custom milestone types and
 * answer recognition queries.
 *
 * Mirrors the Epic E league-service conventions: an {@link Actor} performs the
 * operation, management requires the league owner or an admin, and unknown or
 * unmanageable leagues collapse to a single `not_found` result so callers cannot
 * enumerate leagues they do not control (IDOR-safe).
 *
 * Keys are normalized to the canonical milestone-type slug (shared with the
 * ingestion write path) so a registered custom type and a stored milestone
 * `type` match by string equality.
 */

import type { MilestoneType } from "../db/milestone-types";
import type { Actor } from "../leagues/league-service";

import { getLeagueById } from "../db/leagues";
import {
  insertLeagueMilestoneType,
  listLeagueMilestoneTypes,
} from "../db/milestone-types";
import { validateMilestoneType } from "./validation";

/** Discriminated result for a milestone-type-registry operation. */
export type MilestoneTypeServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "duplicate" | "invalid_type" | "not_found" };

/**
 * Resolve a league and confirm the actor may manage it (owner or admin).
 * Unknown leagues and leagues the actor neither owns nor admins both resolve to
 * `not_found`, deliberately indistinguishable.
 */
async function canManageLeague(
  db: D1Database,
  actor: Actor,
  leagueId: number,
): Promise<boolean> {
  const league = await getLeagueById(db, leagueId);
  if (!league) return false;
  return actor.isAdmin || league.owner_user_id === actor.userId;
}

/**
 * Register a custom milestone type for a league. Requires the actor to own the
 * league or be an admin. The key is normalized and validated; a duplicate key
 * within the league resolves to `duplicate`.
 */
export async function registerLeagueMilestoneType(
  db: D1Database,
  actor: Actor,
  leagueId: number,
  rawKey: unknown,
  label: null | string = null,
): Promise<MilestoneTypeServiceResult<MilestoneType>> {
  if (!(await canManageLeague(db, actor, leagueId))) {
    return { ok: false, reason: "not_found" };
  }

  const key = validateMilestoneType(rawKey);
  if (!key.ok) return { ok: false, reason: "invalid_type" };

  const created = await insertLeagueMilestoneType(db, {
    league_id: leagueId,
    key: key.value,
    label: label?.trim() ? label.trim() : null,
    created_by_user_id: actor.userId,
  });
  if (!created) return { ok: false, reason: "duplicate" };
  return { ok: true, value: created };
}

/**
 * List a league's custom milestone types. Requires the actor to own the league
 * or be an admin (management surface).
 */
export async function listLeagueMilestoneTypesForActor(
  db: D1Database,
  actor: Actor,
  leagueId: number,
): Promise<MilestoneTypeServiceResult<MilestoneType[]>> {
  if (!(await canManageLeague(db, actor, leagueId))) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, value: await listLeagueMilestoneTypes(db, leagueId) };
}
