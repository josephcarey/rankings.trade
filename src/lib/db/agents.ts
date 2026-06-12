/**
 * Typed query helpers for the `agents` table and the `agent_ownership_events`
 * audit trail.
 *
 * One **active owner per agent** is the core invariant. It is enforced at the
 * database with an atomic conditional claim rather than in app code, so two
 * concurrent claims can never both win. Callsign symbols are normalized
 * (trimmed + upper-cased) and validated before they touch the database.
 *
 * Forward-only pattern: no schema mutations here, only DML.
 */

/** Callsign format: 3–20 chars, upper-case alphanumerics plus `_` and `-`. */
export const SYMBOL_PATTERN = /^[A-Z0-9_-]{3,20}$/;

/** Full agent record as stored in the database. */
export type Agent = {
  id: number;
  symbol: string;
  display_name: string | null;
  /** Null while the agent is scraped-but-unclaimed. */
  owner_user_id: number | null;
  /** 0 = unverified (trust-based v1 claim), 1 = verified. */
  verified: number;
  created_at: string;
  updated_at: string;
};

/** Ownership-change audit event kinds. */
type OwnershipEventType = "admin_release" | "claim" | "transfer";

/** Input for {@link recordOwnershipEvent}. */
export type OwnershipEventInput = {
  agent_id: number;
  event_type: OwnershipEventType;
  actor_user_id?: number | null;
  prior_owner_user_id?: number | null;
  new_owner_user_id?: number | null;
  reason?: string | null;
};

/**
 * Outcome of a {@link claimAgent} call.
 *
 * - `claimed` — the caller now owns the agent (it was unclaimed).
 * - `already_owner` — the caller already owned it (idempotent no-op).
 * - `already_claimed` — another user owns it; ownership is unchanged.
 * - `invalid_symbol` — the callsign failed validation; nothing was written.
 */
type ClaimStatus =
  | "already_claimed"
  | "already_owner"
  | "claimed"
  | "invalid_symbol";

/** Result of {@link claimAgent}. */
export type ClaimResult = {
  status: ClaimStatus;
  agent: Agent | null;
};

/** Normalize a raw callsign to its canonical form (trimmed, upper-cased). */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

/** True when `symbol` (already normalized) matches {@link SYMBOL_PATTERN}. */
export function isValidSymbol(symbol: string): boolean {
  return SYMBOL_PATTERN.test(symbol);
}

/**
 * Retrieve an agent by its (raw or normalized) callsign symbol.
 *
 * @returns The matching agent, or null if none exists.
 */
export async function getAgentBySymbol(
  db: D1Database,
  symbol: string,
): Promise<Agent | null> {
  const normalized = normalizeSymbol(symbol);
  const result = await db
    .prepare("SELECT * FROM agents WHERE symbol = ?")
    .bind(normalized)
    .first<Agent>();
  return result ?? null;
}

/**
 * Retrieve an agent by its primary key.
 *
 * @returns The matching agent, or null if none exists.
 */
export async function getAgentById(
  db: D1Database,
  id: number,
): Promise<Agent | null> {
  const result = await db
    .prepare("SELECT * FROM agents WHERE id = ?")
    .bind(id)
    .first<Agent>();
  return result ?? null;
}

/**
 * List the agents owned by a given user, newest first.
 */
export async function listAgentsByOwner(
  db: D1Database,
  ownerUserId: number,
): Promise<Agent[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM agents WHERE owner_user_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(ownerUserId)
    .all<Agent>();
  return results ?? [];
}

/**
 * Create an agent row (optionally already owned). Used both for user claims and
 * for seeding scraped-but-unclaimed participants.
 *
 * @throws If the symbol is invalid after normalization.
 */
export async function createAgent(
  db: D1Database,
  input: { symbol: string; owner_user_id?: number | null; display_name?: string | null },
): Promise<Agent> {
  const symbol = normalizeSymbol(input.symbol);
  if (!isValidSymbol(symbol)) {
    throw new Error(`createAgent: invalid symbol (${input.symbol})`);
  }

  await db
    .prepare(
      "INSERT INTO agents (symbol, owner_user_id, display_name) VALUES (?, ?, ?)",
    )
    .bind(symbol, input.owner_user_id ?? null, input.display_name ?? null)
    .run();

  const agent = await getAgentBySymbol(db, symbol);
  if (!agent) {
    throw new Error(`createAgent: record not found after write (${symbol})`);
  }
  return agent;
}

/**
 * Record an ownership-change audit event.
 */
export async function recordOwnershipEvent(
  db: D1Database,
  input: OwnershipEventInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO agent_ownership_events
         (agent_id, event_type, actor_user_id, prior_owner_user_id, new_owner_user_id, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.agent_id,
      input.event_type,
      input.actor_user_id ?? null,
      input.prior_owner_user_id ?? null,
      input.new_owner_user_id ?? null,
      input.reason ?? null,
    )
    .run();
}

/**
 * Set (or clear) an agent's owner and return the updated record.
 *
 * Does not enforce the one-active-owner invariant — callers performing a claim
 * must use {@link claimAgent}; this is the lower-level primitive used by the
 * admin transfer flow inside a guarded sequence.
 */
export async function setAgentOwner(
  db: D1Database,
  agentId: number,
  ownerUserId: number | null,
): Promise<Agent | null> {
  await db
    .prepare(
      "UPDATE agents SET owner_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(ownerUserId, agentId)
    .run();
  return getAgentById(db, agentId);
}

/**
 * Atomically transfer an agent to a new owner: compare-and-set the owner, revoke
 * the prior owner's active tokens, and write a `transfer` audit event — as a
 * single D1 batch (all-or-nothing), so a failure in any step rolls the whole
 * thing back rather than leaving the prior owner's tokens live with the owner
 * already changed.
 *
 * The revoke and audit statements are gated on `EXISTS (agent now owned by
 * newOwnerId)`, which — given sequential intra-transaction visibility — is only
 * true once the compare-and-set in the same batch has taken effect. So a
 * concurrent ownership change that makes the CAS match no rows leaves no partial
 * writes. Callers detect that `conflict` by re-reading the agent afterwards.
 */
export async function transferOwnershipAtomic(
  db: D1Database,
  input: {
    actorUserId: number;
    agentId: number;
    newOwnerId: number;
    priorOwnerId: number | null;
    reason: string | null;
  },
): Promise<void> {
  const { actorUserId, agentId, newOwnerId, priorOwnerId, reason } = input;

  const cas = db
    .prepare(
      `UPDATE agents
       SET owner_user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_user_id IS ?`,
    )
    .bind(newOwnerId, agentId, priorOwnerId);

  const revoke = db
    .prepare(
      `UPDATE agent_tokens
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE agent_id = ? AND owner_user_id = ? AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM agents WHERE id = ? AND owner_user_id = ?)`,
    )
    .bind(agentId, priorOwnerId, agentId, newOwnerId);

  const audit = db
    .prepare(
      `INSERT INTO agent_ownership_events
         (agent_id, event_type, actor_user_id, prior_owner_user_id, new_owner_user_id, reason)
       SELECT ?, 'transfer', ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM agents WHERE id = ? AND owner_user_id = ?)`,
    )
    .bind(agentId, actorUserId, priorOwnerId, newOwnerId, reason, agentId, newOwnerId);

  await db.batch([cas, revoke, audit]);
}

/**
 * Atomically claim an agent callsign for a user (trust-based, unverified).
 *
 * The claim is a single conditional upsert: it inserts the agent owned by the
 * caller when the symbol is unseen, or — on a symbol conflict — assigns the
 * caller as owner **only when the row is currently unowned**
 * (`agents.owner_user_id IS NULL`). The persisted owner after the write
 * determines the outcome, so two racing claims can never both succeed. A
 * successful new claim also writes a `claim` audit event.
 *
 * @returns A {@link ClaimResult} describing the outcome.
 */
export async function claimAgent(
  db: D1Database,
  symbol: string,
  userId: number,
): Promise<ClaimResult> {
  const normalized = normalizeSymbol(symbol);
  if (!isValidSymbol(normalized)) {
    return { status: "invalid_symbol", agent: null };
  }

  // Fast path: an already-owned symbol short-circuits without a write.
  const existing = await getAgentBySymbol(db, normalized);
  if (existing && existing.owner_user_id !== null) {
    return {
      status: existing.owner_user_id === userId ? "already_owner" : "already_claimed",
      agent: existing,
    };
  }

  // Insert-or-claim: assign the caller as owner only if the row is unowned.
  await db
    .prepare(
      `INSERT INTO agents (symbol, owner_user_id)
       VALUES (?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         owner_user_id = excluded.owner_user_id,
         updated_at    = CURRENT_TIMESTAMP
       WHERE agents.owner_user_id IS NULL`,
    )
    .bind(normalized, userId)
    .run();

  const agent = await getAgentBySymbol(db, normalized);
  if (!agent || agent.owner_user_id !== userId) {
    // Lost a race: someone else claimed it between the check and the write.
    return { status: "already_claimed", agent: agent ?? null };
  }

  await recordOwnershipEvent(db, {
    agent_id: agent.id,
    event_type: "claim",
    actor_user_id: userId,
    new_owner_user_id: userId,
  });

  return { status: "claimed", agent };
}
