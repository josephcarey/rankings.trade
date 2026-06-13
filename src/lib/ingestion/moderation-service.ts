/**
 * Moderation service: owner/admin removal of bot-ingested logs and milestones.
 *
 * Mirrors the Epic E service conventions: an {@link Actor} performs the
 * operation and unauthorized or unknown targets collapse to a single
 * `not_found` result (IDOR-safe — a moderator cannot probe for content they may
 * not act on). Deletion is a SOFT-DELETE: the row is hidden from reads but kept
 * for audit, with the moderator and reason recorded.
 *
 * Moderation authority over an agent's content is limited to an admin or the
 * agent's OWNER. League owners are deliberately excluded: a log/milestone is a
 * single global record shown across every league and the agent's profile, so a
 * single league owner must not be able to censor it everywhere.
 */

import type { LogRecord } from "../db/logs";
import type { MilestoneRecord } from "../db/milestones";
import type { Actor } from "../leagues/league-service";

import { getAgentById, getAgentBySymbol } from "../db/agents";
import { getLogById, listLogsByAgent, softDeleteLog } from "../db/logs";
import {
  getMilestoneById,
  listMilestonesByAgent,
  softDeleteMilestone,
} from "../db/milestones";

/** Discriminated result for a moderation operation. */
export type ModerationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" };

/**
 * Whether `actor` may moderate content produced by `agentId`: true for an admin
 * or the agent's current owner. An unclaimed agent (NULL owner) is moderable
 * only by an admin.
 */
export async function canModerateAgentContent(
  db: D1Database,
  actor: Actor,
  agentId: number,
): Promise<boolean> {
  if (actor.isAdmin) return true;
  const agent = await getAgentById(db, agentId);
  return agent?.owner_user_id != null && agent.owner_user_id === actor.userId;
}

/**
 * Soft-delete a log. Returns `not_found` for an unknown id, an already-deleted
 * log, or one the actor may not moderate (all indistinguishable).
 */
export async function deleteLog(
  db: D1Database,
  actor: Actor,
  logId: number,
  reason: null | string = null,
): Promise<ModerationResult<LogRecord>> {
  const log = await getLogById(db, logId);
  if (!log || log.deleted_at !== null) return { ok: false, reason: "not_found" };
  if (!(await canModerateAgentContent(db, actor, log.agent_id))) {
    return { ok: false, reason: "not_found" };
  }
  const deleted = await softDeleteLog(db, logId, actor.userId, reason);
  if (!deleted) return { ok: false, reason: "not_found" };
  return { ok: true, value: deleted };
}

/**
 * Soft-delete a milestone. Returns `not_found` for an unknown id, an
 * already-deleted milestone, or one the actor may not moderate.
 */
export async function deleteMilestone(
  db: D1Database,
  actor: Actor,
  milestoneId: number,
  reason: null | string = null,
): Promise<ModerationResult<MilestoneRecord>> {
  const milestone = await getMilestoneById(db, milestoneId);
  if (!milestone || milestone.deleted_at !== null) {
    return { ok: false, reason: "not_found" };
  }
  if (!(await canModerateAgentContent(db, actor, milestone.agent_id))) {
    return { ok: false, reason: "not_found" };
  }
  const deleted = await softDeleteMilestone(db, milestoneId, actor.userId, reason);
  if (!deleted) return { ok: false, reason: "not_found" };
  return { ok: true, value: deleted };
}

/**
 * List an agent's non-deleted logs for a moderator. Returns `not_found` when the
 * callsign is unknown or the actor may not moderate it (no existence leak).
 */
export async function listAgentLogsForModerator(
  db: D1Database,
  actor: Actor,
  symbol: string,
): Promise<ModerationResult<LogRecord[]>> {
  const agent = await getAgentBySymbol(db, symbol);
  if (!agent || !(await canModerateAgentContent(db, actor, agent.id))) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, value: await listLogsByAgent(db, agent.id) };
}

/**
 * List an agent's non-deleted milestones for a moderator. Returns `not_found`
 * when the callsign is unknown or unmoderable by the actor.
 */
export async function listAgentMilestonesForModerator(
  db: D1Database,
  actor: Actor,
  symbol: string,
): Promise<ModerationResult<MilestoneRecord[]>> {
  const agent = await getAgentBySymbol(db, symbol);
  if (!agent || !(await canModerateAgentContent(db, actor, agent.id))) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, value: await listMilestonesByAgent(db, agent.id) };
}
