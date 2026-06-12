/**
 * Admin ownership-transfer service: the tested logic behind the admin transfer
 * API and form action. Reassigns an agent to a new owner, revokes the prior
 * owner's active tokens, and writes an audit event.
 *
 * Not wrapped in a DB transaction (this codebase has no transaction helper and
 * `claimAgent` is likewise multi-statement). Ordering is chosen so the displaced
 * owner loses control first: compare-and-set the owner, then revoke the prior
 * owner's tokens, then record the audit event describing the final state. A
 * failure in a later step surfaces as a thrown error to the caller rather than a
 * silently-swallowed partial success.
 */

import type { Agent } from "../db/agents";

import { revokeAllActiveTokensForOwner } from "../db/agent-tokens";
import {
  getAgentBySymbol,
  normalizeSymbol,
  recordOwnershipEvent,
  setAgentOwnerIfCurrent,
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
 * Steps: validate input → resolve agent + target user → compare-and-set the
 * owner (rejecting a concurrent change as `conflict`) → revoke the prior owner's
 * active tokens (snapshot-scoped, so the new owner's own tokens are untouched) →
 * write a `transfer` audit event.
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

  const changed = await setAgentOwnerIfCurrent(db, agent.id, priorOwner, newUser.id);
  if (!changed) {
    return { ok: false, reason: "conflict" };
  }

  const revokedTokens =
    priorOwner === null
      ? 0
      : await revokeAllActiveTokensForOwner(db, agent.id, priorOwner);

  await recordOwnershipEvent(db, {
    actor_user_id: input.actorUserId,
    agent_id: agent.id,
    event_type: "transfer",
    new_owner_user_id: newUser.id,
    prior_owner_user_id: priorOwner,
    reason,
  });

  const updated = (await getAgentBySymbol(db, agent.symbol)) ?? agent;
  return { ok: true, value: { agent: updated, priorOwnerUserId: priorOwner, revokedTokens } };
}
