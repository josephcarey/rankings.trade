/**
 * Typed query helpers for the `agent_tokens` table.
 *
 * Tokens are stored only as a SHA-256 hash (see `src/lib/agents/token.ts`); the
 * raw secret never reaches this layer. Each row snapshots `owner_user_id` at
 * creation so an ownership transfer can revoke exactly the prior owner's tokens.
 *
 * Forward-only pattern: no schema mutations here, only DML.
 */

/** Inclusive bounds for a human-supplied token label. */
const LABEL_MIN = 1;
const LABEL_MAX = 60;

/** Full agent-token record as stored in the database. */
export type AgentToken = {
  id: number;
  agent_id: number;
  owner_user_id: number;
  token_hash: string;
  token_prefix: string;
  label: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

/** Fields required to persist a freshly generated token. */
export type InsertTokenInput = {
  agent_id: number;
  owner_user_id: number;
  token_hash: string;
  token_prefix: string;
  label: string;
};

/** True when a label is within the allowed length bounds. */
export function isValidLabel(label: string): boolean {
  return label.length >= LABEL_MIN && label.length <= LABEL_MAX;
}

async function getTokenById(
  db: D1Database,
  id: number,
): Promise<AgentToken | null> {
  const result = await db
    .prepare("SELECT * FROM agent_tokens WHERE id = ?")
    .bind(id)
    .first<AgentToken>();
  return result ?? null;
}

async function getTokenByHash(
  db: D1Database,
  hash: string,
): Promise<AgentToken | null> {
  const result = await db
    .prepare("SELECT * FROM agent_tokens WHERE token_hash = ?")
    .bind(hash)
    .first<AgentToken>();
  return result ?? null;
}

/**
 * Persist a generated token (hash + prefix + label) for an agent.
 *
 * @throws If the label is outside the allowed length bounds.
 */
export async function insertToken(
  db: D1Database,
  input: InsertTokenInput,
): Promise<AgentToken> {
  if (!isValidLabel(input.label)) {
    throw new Error(`insertToken: label must be ${LABEL_MIN}-${LABEL_MAX} chars`);
  }

  await db
    .prepare(
      `INSERT INTO agent_tokens (agent_id, owner_user_id, token_hash, token_prefix, label)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      input.agent_id,
      input.owner_user_id,
      input.token_hash,
      input.token_prefix,
      input.label,
    )
    .run();

  const token = await getTokenByHash(db, input.token_hash);
  if (!token) {
    throw new Error("insertToken: record not found after write");
  }
  return token;
}

/**
 * List every token (active and revoked) for an agent, newest first.
 */
export async function listTokensByAgent(
  db: D1Database,
  agentId: number,
): Promise<AgentToken[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM agent_tokens WHERE agent_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(agentId)
    .all<AgentToken>();
  return results ?? [];
}

/**
 * Look up a non-revoked token by its stored SHA-256 hash.
 *
 * @returns The active token, or null when unknown or revoked.
 */
export async function findActiveTokenByHash(
  db: D1Database,
  hash: string,
): Promise<AgentToken | null> {
  const result = await db
    .prepare(
      "SELECT * FROM agent_tokens WHERE token_hash = ? AND revoked_at IS NULL",
    )
    .bind(hash)
    .first<AgentToken>();
  return result ?? null;
}

/**
 * Revoke a single token, scoped to its agent for authorization.
 *
 * Idempotent: revoking an already-revoked token leaves the original
 * `revoked_at` unchanged.
 *
 * @returns The token row after the update, or null if it does not belong to the
 *   given agent.
 */
export async function revokeToken(
  db: D1Database,
  id: number,
  agentId: number,
): Promise<AgentToken | null> {
  await db
    .prepare(
      `UPDATE agent_tokens
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = ? AND agent_id = ? AND revoked_at IS NULL`,
    )
    .bind(id, agentId)
    .run();

  const token = await getTokenById(db, id);
  return token && token.agent_id === agentId ? token : null;
}

/**
 * Count an agent's active (non-revoked) tokens for a specific owner.
 *
 * Used by the admin ownership-transfer flow to report how many of the prior
 * owner's tokens the (atomic) transfer revokes.
 *
 * @returns The number of active tokens for that owner.
 */
export async function countActiveTokensForOwner(
  db: D1Database,
  agentId: number,
  ownerUserId: number,
): Promise<number> {
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM agent_tokens
       WHERE agent_id = ? AND owner_user_id = ? AND revoked_at IS NULL`,
    )
    .bind(agentId, ownerUserId)
    .first<{ n: number }>();
  return countRow?.n ?? 0;
}

/**
 * Rotate a token: revoke the named (active) token and insert exactly one
 * replacement carrying the same label and owner. The caller supplies the new
 * token's hash/prefix from `generateToken`.
 *
 * @returns The new token row, or null if the named token is missing, revoked, or
 *   not owned by the given agent.
 */
export async function rotateToken(
  db: D1Database,
  input: { id: number; agent_id: number; token_hash: string; token_prefix: string },
): Promise<AgentToken | null> {
  const existing = await db
    .prepare(
      "SELECT * FROM agent_tokens WHERE id = ? AND agent_id = ? AND revoked_at IS NULL",
    )
    .bind(input.id, input.agent_id)
    .first<AgentToken>();
  if (!existing) return null;

  await db
    .prepare("UPDATE agent_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(input.id)
    .run();

  return insertToken(db, {
    agent_id: existing.agent_id,
    owner_user_id: existing.owner_user_id,
    token_hash: input.token_hash,
    token_prefix: input.token_prefix,
    label: existing.label,
  });
}

/**
 * Stamp a token's `last_used_at` to now. Callers (e.g. the bot middleware)
 * decide how often to call this; this helper writes unconditionally.
 */
export async function touchLastUsed(db: D1Database, id: number): Promise<void> {
  await db
    .prepare("UPDATE agent_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(id)
    .run();
}
