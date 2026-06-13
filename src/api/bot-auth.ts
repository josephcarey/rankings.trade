import type { MiddlewareHandler } from "hono";

import type { AgentToken } from "../lib/db/agent-tokens";
import type { Agent } from "../lib/db/agents";
import type { CloudflareBindings } from "../platform";

import { createErrorResponse } from "../errors";
import { hashToken } from "../lib/agents/token";
import { findActiveTokenByHash, touchLastUsed } from "../lib/db/agent-tokens";
import { getAgentById } from "../lib/db/agents";
import { logger } from "../logger";

/** Studio error envelope for a request lacking a valid agent token. */
const AGENT_UNAUTHORIZED = createErrorResponse(
  "unauthorized",
  "A valid agent API token is required.",
);

/** How stale `last_used_at` must be before a successful auth rewrites it. */
const LAST_USED_THROTTLE_MS = 10 * 60 * 1000;

/** Hono context variables a bot handler can read after {@link requireAgentToken}. */
export type BotVariables = {
  agent: Agent;
  token: AgentToken;
};

type BotEnv = {
  Bindings: CloudflareBindings;
  Variables: BotVariables;
};

/** Extract the raw token from an `Authorization: Bearer <token>` header. */
export function parseBearer(header: null | string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token || null;
}

/**
 * Decide whether a successful auth should rewrite `last_used_at`.
 *
 * Returns true when the token has never recorded a use, or the stored timestamp
 * is older than {@link LAST_USED_THROTTLE_MS}, so the common case does not write
 * on every request.
 */
export function shouldRefreshLastUsed(
  lastUsedAt: null | string,
  now: Date,
  thresholdMs: number = LAST_USED_THROTTLE_MS,
): boolean {
  if (!lastUsedAt) return true;
  // SQLite CURRENT_TIMESTAMP is `YYYY-MM-DD HH:MM:SS` in UTC.
  const previous = Date.parse(`${lastUsedAt.replace(" ", "T")}Z`);
  if (Number.isNaN(previous)) return true;
  return now.getTime() - previous >= thresholdMs;
}

/**
 * Build the bot authentication middleware.
 *
 * This is a distinct, bot-only auth path: it requires a per-agent Bearer token
 * (never a Clerk session). On success it attaches the resolved agent and token
 * row to the context and throttles `last_used_at` writes.
 *
 * @param deps.now - Clock injection for testability (defaults to wall clock).
 */
export function createRequireAgentToken(deps: {
  now?: () => Date;
} = {}): MiddlewareHandler<BotEnv> {
  const now = deps.now ?? (() => new Date());

  return async (context, next) => {
    const raw = parseBearer(context.req.header("Authorization"));
    if (!raw) {
      return context.json(AGENT_UNAUTHORIZED, 401);
    }

    const hash = await hashToken(raw);
    const token = await findActiveTokenByHash(context.env.DB, hash);
    if (!token) {
      return context.json(AGENT_UNAUTHORIZED, 401);
    }

    const agent = await getAgentById(context.env.DB, token.agent_id);
    if (!agent) {
      return context.json(AGENT_UNAUTHORIZED, 401);
    }

    // Fail closed: a token snapshots its owner at creation. If that no longer
    // matches the agent's current owner (e.g. ownership was transferred or
    // released), reject — so authz never rests solely on revocation having run.
    if (token.owner_user_id !== agent.owner_user_id) {
      return context.json(AGENT_UNAUTHORIZED, 401);
    }

    // Advisory only: a transient failure on the `last_used_at` write must never
    // reject an otherwise-valid auth, so it is best-effort and swallowed.
    if (shouldRefreshLastUsed(token.last_used_at, now())) {
      try {
        await touchLastUsed(context.env.DB, token.id);
      } catch (error) {
        logger.warn("touchLastUsed failed", {
          tokenId: token.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    context.set("agent", agent);
    context.set("token", token);
    await next();
  };
}

/** Default bot auth middleware wired to the wall clock. */
export const requireAgentToken = createRequireAgentToken();
