/**
 * Token-management service: the tested logic layer behind the agent token
 * management API and UI. Composes ownership checks (`agents.ts`), secure token
 * generation (`token.ts`), and persistence (`agent-tokens.ts`).
 *
 * Security invariants enforced here:
 * - Only an agent's current owner may list/create/revoke/rotate its tokens.
 *   "Agent not found" and "not your agent" collapse to a single negative result
 *   so callers cannot enumerate callsigns they do not own.
 * - The raw token is returned exactly once (create/rotate) and is never stored,
 *   reloaded, or included in list output. `token_hash` is never surfaced.
 */

import type { AgentToken } from "../db/agent-tokens";
import type { Agent } from "../db/agents";
import type { GeneratedToken } from "./token";

import {
  insertToken,
  isValidLabel,
  listTokensByAgent,
  revokeToken as revokeTokenRow,
  rotateToken as rotateTokenRow,
} from "../db/agent-tokens";
import { getAgentBySymbol, normalizeSymbol } from "../db/agents";
import { generateToken } from "./token";

/** Non-secret projection of a token row safe to send to clients. */
export type TokenView = {
  id: number;
  label: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  status: "active" | "revoked";
};

/** Result of creating or rotating a token — the raw secret is shown once. */
export type IssuedToken = {
  token: string;
  view: TokenView;
};

type OwnerCheck = { agent: Agent; ok: true } | { ok: false };

/** Project a stored token row to its non-secret client view. */
function toTokenView(row: AgentToken): TokenView {
  return {
    created_at: row.created_at,
    id: row.id,
    label: row.label,
    last_used_at: row.last_used_at,
    status: row.revoked_at === null ? "active" : "revoked",
    token_prefix: row.token_prefix,
  };
}

/**
 * Parse a URL path segment as a positive token id.
 *
 * Rejects non-digits, zero, negatives, floats, and unsafe integers so malformed
 * input never reaches the database.
 */
export function parseTokenId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Resolve an agent by symbol and confirm the caller currently owns it.
 *
 * Returns `{ ok: false }` for both unknown agents and agents owned by someone
 * else, deliberately indistinguishable to prevent ownership enumeration.
 */
async function requireOwnedAgent(
  db: D1Database,
  symbol: string,
  userId: number,
): Promise<OwnerCheck> {
  const agent = await getAgentBySymbol(db, normalizeSymbol(symbol));
  if (!agent || agent.owner_user_id !== userId) {
    return { ok: false };
  }
  return { agent, ok: true };
}

/** Discriminated result for token-management operations. */
export type TokenServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "invalid_label" | "not_found" };

/**
 * List a caller-owned agent's tokens (active and revoked) as non-secret views.
 */
export async function listAgentTokens(
  db: D1Database,
  symbol: string,
  userId: number,
): Promise<TokenServiceResult<TokenView[]>> {
  const owned = await requireOwnedAgent(db, symbol, userId);
  if (!owned.ok) return { ok: false, reason: "not_found" };

  const rows = await listTokensByAgent(db, owned.agent.id);
  return { ok: true, value: rows.map((row) => toTokenView(row)) };
}

/**
 * Create a token for a caller-owned agent. The raw secret in the result is the
 * only time it is ever available.
 */
export async function createAgentToken(
  db: D1Database,
  symbol: string,
  userId: number,
  rawLabel: string,
): Promise<TokenServiceResult<IssuedToken>> {
  const label = rawLabel.trim();
  if (!isValidLabel(label)) return { ok: false, reason: "invalid_label" };

  const owned = await requireOwnedAgent(db, symbol, userId);
  if (!owned.ok) return { ok: false, reason: "not_found" };

  const generated: GeneratedToken = await generateToken();
  const row = await insertToken(db, {
    agent_id: owned.agent.id,
    label,
    owner_user_id: userId,
    token_hash: generated.hash,
    token_prefix: generated.prefix,
  });

  return { ok: true, value: { token: generated.token, view: toTokenView(row) } };
}

/**
 * Revoke one of a caller-owned agent's tokens. Idempotent at the data layer;
 * returns `not_found` when the token does not belong to the agent.
 */
export async function revokeAgentToken(
  db: D1Database,
  symbol: string,
  userId: number,
  tokenId: number,
): Promise<TokenServiceResult<TokenView>> {
  const owned = await requireOwnedAgent(db, symbol, userId);
  if (!owned.ok) return { ok: false, reason: "not_found" };

  const row = await revokeTokenRow(db, tokenId, owned.agent.id);
  if (!row) return { ok: false, reason: "not_found" };
  return { ok: true, value: toTokenView(row) };
}

/**
 * Rotate one of a caller-owned agent's tokens: revoke it and issue exactly one
 * replacement carrying the same label. The new raw secret is shown once.
 */
export async function rotateAgentToken(
  db: D1Database,
  symbol: string,
  userId: number,
  tokenId: number,
): Promise<TokenServiceResult<IssuedToken>> {
  const owned = await requireOwnedAgent(db, symbol, userId);
  if (!owned.ok) return { ok: false, reason: "not_found" };

  const generated: GeneratedToken = await generateToken();
  const row = await rotateTokenRow(db, {
    agent_id: owned.agent.id,
    id: tokenId,
    token_hash: generated.hash,
    token_prefix: generated.prefix,
  });
  if (!row) return { ok: false, reason: "not_found" };

  return { ok: true, value: { token: generated.token, view: toTokenView(row) } };
}
