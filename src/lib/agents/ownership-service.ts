/**
 * Admin ownership-transfer service: the tested logic behind the admin transfer
 * API and form action. Reassigns an agent to a new owner, revokes the prior
 * owner's active tokens, and writes an audit event.
 *
 * The three writes (owner compare-and-set, prior-owner token revocation, audit
 * insert) run as a single atomic `db.batch` (see {@link transferOwnershipAtomic})
 * so they are all-or-nothing: a failure in any step rolls back the owner change
 * too, and the prior owner can never be left displaced with their tokens still
 * live. A concurrent ownership change is surfaced as `conflict`.
 */

import type { Agent } from "../db/agents";

import { countActiveTokensForOwner } from "../db/agent-tokens";
import {
  getAgentById,
  getAgentBySymbol,
  normalizeSymbol,
  transferOwnershipAtomic,
} from "../db/agents";
import { getUserByClerkId } from "../db/users";

/** Maximum length of the optional, admin-supplied transfer reason. */
const REASON_MAX = 500;

/** Why a transfer could not be completed. */
export type TransferFailureReason =
  | "agent_not_found"
  | "conflict"
  | "invalid_input"
  | "unchanged"
  | "user_not_found";

/** Successful transfer outcome. */
type TransferOutcome = {
  agent: Agent;
  priorOwnerUserId: number | null;
  revokedTokens: number;
};

export type TransferResult =
  | { ok: false; reason: TransferFailureReason }
  | { ok: true; value: TransferOutcome };

export type TransferInput = {
  /** Local numeric id of the admin performing the transfer (for the audit). */
  actorUserId: number;
  /** Clerk user id of the user the agent is being transferred to. */
  newOwnerClerkId: string;
  /** Optional free-text justification, recorded in the audit event. */
  reason?: null | string;
  /** Agent callsign (normalized internally). */
  symbol: string;
};

/**
 * Transfer an agent to a new owner with prior-owner token revocation + audit.
 *
 * Steps: validate input → resolve agent + target user → (atomic batch) compare-
 * and-set the owner, revoke the prior owner's active tokens, write the audit
 * event → re-read to confirm. A concurrent ownership change leaves no partial
 * writes and is reported as `conflict`.
 */
export async function transferAgentOwnership(
  db: D1Database,
  input: TransferInput,
): Promise<TransferResult> {
  const clerkId = input.newOwnerClerkId.trim();
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  if (!clerkId || (reason !== null && reason.length > REASON_MAX)) {
    return { ok: false, reason: "invalid_input" };
  }

  const agent = await getAgentBySymbol(db, normalizeSymbol(input.symbol));
  if (!agent) {
    return { ok: false, reason: "agent_not_found" };
  }

  const newUser = await getUserByClerkId(db, clerkId);
  if (!newUser) {
    return { ok: false, reason: "user_not_found" };
  }

  const priorOwner = agent.owner_user_id;
  if (priorOwner === newUser.id) {
    return { ok: false, reason: "unchanged" };
  }

  // Best-effort count of what the transfer revokes (reported on success only).
  const revokedTokens =
    priorOwner === null ? 0 : await countActiveTokensForOwner(db, agent.id, priorOwner);

  await transferOwnershipAtomic(db, {
    actorUserId: input.actorUserId,
    agentId: agent.id,
    newOwnerId: newUser.id,
    priorOwnerId: priorOwner,
    reason,
  });

  const updated = await getAgentById(db, agent.id);
  if (!updated || updated.owner_user_id !== newUser.id) {
    return { ok: false, reason: "conflict" };
  }
  return { ok: true, value: { agent: updated, priorOwnerUserId: priorOwner, revokedTokens } };
}
