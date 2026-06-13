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

import type { LeagueInvite } from "../db/league-invites";
import type { League, LeagueUpdate, Visibility } from "../db/leagues";
import type { GeneratedInviteToken } from "./invite-token";

import {
  createAgent,
  getAgentById,
  getAgentBySymbol,
  isValidSymbol,
  normalizeSymbol,
} from "../db/agents";
import {
  createInvite,
  findActiveInviteByHash,
  listInvitesByLeague,
  revokeInvite,
  rotateInvite,
} from "../db/league-invites";
import {
  addMember,
  leaveMember,
  listActiveParticipants,
  type ParticipantRow,
  userOwnsActiveMember,
} from "../db/league-members";
import {
  createLeague as createLeagueRow,
  getLeagueById,
  isValidLeagueName,
  updateLeague as updateLeagueRow,
} from "../db/leagues";
import {
  generateInviteToken,
  hashInviteToken,
} from "./invite-token";

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
  | {
      ok: false;
      reason:
        | "agent_not_owned"
        | "invalid_invite"
        | "invalid_name"
        | "invalid_symbol"
        | "not_found";
    };

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

/**
 * Add an agent (by callsign) to a league as an active participant. Requires the
 * actor to own the league or be an admin. The agent may be claimed or unclaimed;
 * an unknown callsign auto-creates an unclaimed agent row. Idempotent if the
 * agent is already an active participant.
 *
 * @returns The active participant row, or a failure reason.
 */
export async function addParticipant(
  db: D1Database,
  actor: Actor,
  leagueId: number,
  rawSymbol: string,
): Promise<LeagueServiceResult<ParticipantRow>> {
  const manageable = await requireManageableLeague(db, actor, leagueId);
  if (!manageable.ok) return { ok: false, reason: "not_found" };

  const symbol = normalizeSymbol(rawSymbol);
  if (!isValidSymbol(symbol)) return { ok: false, reason: "invalid_symbol" };

  const agent =
    (await getAgentBySymbol(db, symbol)) ?? (await createAgent(db, { symbol }));

  const member = await addMember(db, {
    league_id: leagueId,
    agent_id: agent.id,
    added_by_user_id: actor.userId,
  });

  return {
    ok: true,
    value: {
      agent_id: agent.id,
      symbol: agent.symbol,
      display_name: agent.display_name,
      owner_user_id: agent.owner_user_id,
      joined_at: member.joined_at,
    },
  };
}

/**
 * Remove an agent (by callsign) from a league: sets `left_at` on its active
 * membership. Requires the actor to own the league or be an admin. Returns
 * `not_found` when the callsign is unknown or not an active participant.
 */
export async function removeParticipant(
  db: D1Database,
  actor: Actor,
  leagueId: number,
  rawSymbol: string,
): Promise<LeagueServiceResult<{ agent_id: number; symbol: string }>> {
  const manageable = await requireManageableLeague(db, actor, leagueId);
  if (!manageable.ok) return { ok: false, reason: "not_found" };

  const symbol = normalizeSymbol(rawSymbol);
  const agent = await getAgentBySymbol(db, symbol);
  if (!agent) return { ok: false, reason: "not_found" };

  const left = await leaveMember(db, leagueId, agent.id);
  if (!left) return { ok: false, reason: "not_found" };

  return { ok: true, value: { agent_id: agent.id, symbol: agent.symbol } };
}

/**
 * List a league's active participants, subject to the same visibility rules as
 * {@link getViewableLeague} (so private rosters are not leaked).
 */
export async function listParticipants(
  db: D1Database,
  actor: Actor | null,
  leagueId: number,
): Promise<LeagueServiceResult<ParticipantRow[]>> {
  const viewable = await getViewableLeague(db, actor, leagueId);
  if (!viewable.ok) return viewable;
  return { ok: true, value: await listActiveParticipants(db, leagueId) };
}

/** The newly created invite plus its one-time secret token. */
export type CreatedInvite = {
  invite: LeagueInvite;
  token: GeneratedInviteToken["token"];
};

/** The membership produced by accepting an invite. */
export type AcceptedInvite = {
  leagueId: number;
  agentId: number;
  symbol: string;
};

/**
 * Create a new reusable invite link for a league. Requires the actor to own the
 * league or be an admin. The raw token is returned once for display and is never
 * persisted; only its hash and prefix are stored.
 */
export async function createLeagueInvite(
  db: D1Database,
  actor: Actor,
  leagueId: number,
): Promise<LeagueServiceResult<CreatedInvite>> {
  const manageable = await requireManageableLeague(db, actor, leagueId);
  if (!manageable.ok) return { ok: false, reason: "not_found" };

  const generated = await generateInviteToken();
  const invite = await createInvite(db, {
    league_id: leagueId,
    token_hash: generated.hash,
    token_prefix: generated.prefix,
    created_by_user_id: actor.userId,
  });
  return { ok: true, value: { invite, token: generated.token } };
}

/**
 * Rotate a league's invite link: revoke every active invite and issue a fresh
 * one, so any previously shared URL stops working. Requires owner or admin.
 */
export async function rotateLeagueInvite(
  db: D1Database,
  actor: Actor,
  leagueId: number,
): Promise<LeagueServiceResult<CreatedInvite>> {
  const manageable = await requireManageableLeague(db, actor, leagueId);
  if (!manageable.ok) return { ok: false, reason: "not_found" };

  const generated = await generateInviteToken();
  const invite = await rotateInvite(db, {
    league_id: leagueId,
    token_hash: generated.hash,
    token_prefix: generated.prefix,
    created_by_user_id: actor.userId,
  });
  return { ok: true, value: { invite, token: generated.token } };
}

/**
 * Revoke a single invite by id, scoped to its league. Requires owner or admin.
 * Returns `not_found` when the invite does not belong to the league.
 */
export async function revokeLeagueInvite(
  db: D1Database,
  actor: Actor,
  leagueId: number,
  inviteId: number,
): Promise<LeagueServiceResult<LeagueInvite>> {
  const manageable = await requireManageableLeague(db, actor, leagueId);
  if (!manageable.ok) return { ok: false, reason: "not_found" };

  const revoked = await revokeInvite(db, inviteId, leagueId);
  if (!revoked) return { ok: false, reason: "not_found" };
  return { ok: true, value: revoked };
}

/**
 * List every invite (active and revoked) for a league. Requires owner or admin.
 */
export async function listLeagueInvites(
  db: D1Database,
  actor: Actor,
  leagueId: number,
): Promise<LeagueServiceResult<LeagueInvite[]>> {
  const manageable = await requireManageableLeague(db, actor, leagueId);
  if (!manageable.ok) return { ok: false, reason: "not_found" };
  return { ok: true, value: await listInvitesByLeague(db, leagueId) };
}

/**
 * Accept an invite link: the signed-in actor joins one of their own claimed
 * agents to the invite's league. Reusable until revoked.
 *
 * - Unknown or revoked token → `invalid_invite`.
 * - Agent unknown or not owned by the actor → `agent_not_owned`.
 * - Already an active member → idempotent success (no duplicate interval).
 * - Previously left → a new membership interval is opened.
 */
export async function acceptInvite(
  db: D1Database,
  actor: Actor,
  rawToken: string,
  agentId: number,
): Promise<LeagueServiceResult<AcceptedInvite>> {
  const hash = await hashInviteToken(rawToken.trim());
  const invite = await findActiveInviteByHash(db, hash);
  if (!invite) return { ok: false, reason: "invalid_invite" };

  const agent = await getAgentById(db, agentId);
  if (!agent || agent.owner_user_id !== actor.userId) {
    return { ok: false, reason: "agent_not_owned" };
  }

  const member = await addMember(db, {
    league_id: invite.league_id,
    agent_id: agent.id,
    added_by_user_id: actor.userId,
  });

  return {
    ok: true,
    value: {
      leagueId: member.league_id,
      agentId: agent.id,
      symbol: agent.symbol,
    },
  };
}
