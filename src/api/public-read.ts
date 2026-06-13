import type { MiddlewareHandler } from "hono";

import { Hono } from "hono";

import type { PublicRateLimiter } from "../lib/read-api/rate-limit";
import type { Viewer } from "../lib/read-api/read-service";
import type { CloudflareBindings } from "../platform";

import { createErrorResponse } from "../errors";
import { hashToken } from "../lib/agents/token";
import { findActiveTokenByHash } from "../lib/db/agent-tokens";
import { getAgentById } from "../lib/db/agents";
import { openApiDocument } from "../lib/read-api/openapi";
import { resolvePagination } from "../lib/read-api/pagination";
import { createPublicRateLimiter } from "../lib/read-api/rate-limit";
import {
  getAgentView,
  getCurrentSeasonState,
  getLeagueStandingsView,
  getUniverseLeaderboard,
} from "../lib/read-api/read-service";
import { parseBearer } from "./bot-auth";

type ReadEnv = {
  Bindings: CloudflareBindings;
};

/** Shared not-found envelope. Reused for unauthorized private leagues (IDOR-safe). */
const NOT_FOUND = createErrorResponse("not_found", "Resource not found.");

/** Parse a positive integer path id, or null when it is not one. */
function parseId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/**
 * Resolve the optional caller identity from an `Authorization: Bearer` header for private-league
 * authorization. Unlike {@link requireAgentToken}, this NEVER rejects: a missing, malformed, or
 * unknown token simply yields an anonymous viewer (null). The same fail-closed owner check as
 * bot-auth applies — a token whose snapshot owner no longer matches the agent is ignored.
 */
async function resolveOptionalViewer(
  db: D1Database,
  authHeader: null | string | undefined,
): Promise<Viewer> {
  const raw = parseBearer(authHeader);
  if (!raw) return null;

  const token = await findActiveTokenByHash(db, await hashToken(raw));
  if (!token) return null;

  const agent = await getAgentById(db, token.agent_id);
  if (!agent || token.owner_user_id !== agent.owner_user_id) return null;

  return { agentId: agent.id, ownerUserId: agent.owner_user_id };
}

/**
 * Stable client key for rate-limiting.
 *
 * Keys by the bot token ONLY when it passes the SAME validity check as viewer resolution — an
 * active token whose snapshot owner still matches the agent's current owner — as `token:<id>`;
 * otherwise keys by client IP. Keying by the raw, unvalidated bearer would let a caller send a
 * fresh random `Authorization: Bearer <junk>` per request to land in a new bucket every time,
 * evading the per-IP budget (audit §6.1); a stale (owner-mismatched) token must not earn its
 * own bucket either, since it is not a valid identity.
 */
async function clientKey(
  db: D1Database,
  authHeader: null | string | undefined,
  ip: string,
): Promise<string> {
  const raw = parseBearer(authHeader);
  if (raw) {
    const token = await findActiveTokenByHash(db, await hashToken(raw));
    if (token) {
      const agent = await getAgentById(db, token.agent_id);
      if (agent && token.owner_user_id === agent.owner_user_id) {
        return `token:${token.id}`;
      }
    }
  }
  return `ip:${ip}`;
}

/** Best-effort client IP from Cloudflare / proxy headers. */
function clientIp(header: (name: string) => string | undefined): string {
  return (
    header("CF-Connecting-IP") ??
    header("X-Forwarded-For")?.split(",", 1)[0]?.trim() ??
    "unknown"
  );
}

/**
 * Build the route-scoped rate-limit middleware. It records one hit per request, always emits the
 * `X-RateLimit-*` headers, and returns 429 (+ `Retry-After`) once the window's budget is spent.
 * Applied per data route (not globally) so it never runs for the co-mounted Clerk/ingestion
 * routes on `/agents` and `/leagues`.
 */
function createRateLimit(
  limiter: PublicRateLimiter,
  now: () => Date,
): MiddlewareHandler<ReadEnv> {
  return async (context, next) => {
    const key = await clientKey(
      context.env.DB,
      context.req.header("Authorization"),
      clientIp((name) => context.req.header(name)),
    );
    const decision = limiter.check(key, now().getTime());

    context.header("X-RateLimit-Limit", String(decision.limit));
    context.header("X-RateLimit-Remaining", String(decision.remaining));
    context.header("X-RateLimit-Reset", String(decision.resetSeconds));

    if (!decision.allowed) {
      context.header("Retry-After", String(decision.resetSeconds));
      return context.json(
        createErrorResponse("rate_limited", "Too many requests."),
        429,
      );
    }

    await next();
  };
}

/**
 * Build the public, READ-ONLY router (Epic M).
 *
 * Defines only exact GET routes and NO `use("*")` / custom `notFound`, so any non-matching
 * request 404s and falls through to the later-mounted routers. This is what lets it be mounted
 * on the shared `/api` surface ahead of the Clerk agents/leagues routers without shadowing their
 * routes or Epic F's bot POSTs: a `GET /agents/:symbol` is served here publicly (before any
 * Clerk `use("*")` could 401 it), while `POST /agents/:symbol/logs`, `GET /agents/:symbol/tokens`
 * and `GET /agents/` do not match these routes and fall through untouched.
 *
 * @param deps.now - Clock injection for the rate limiter (defaults to wall clock).
 * @param deps.limiter - Limiter injection for tests (defaults to a fresh per-isolate limiter).
 */
export function createPublicReadApi(
  deps: { now?: () => Date; limiter?: PublicRateLimiter } = {},
) {
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? createPublicRateLimiter();
  const rateLimit = createRateLimit(limiter, now);

  const app = new Hono<ReadEnv>();

  app.get("/agents/:symbol", rateLimit, async (context) => {
    const view = await getAgentView(
      context.env.DB,
      context.req.param("symbol") ?? "",
    );
    if (!view) return context.json(NOT_FOUND, 404);
    return context.json(view);
  });

  app.get("/leagues/:id/standings", rateLimit, async (context) => {
    const id = parseId(context.req.param("id"));
    if (id === null) return context.json(NOT_FOUND, 404);

    const viewer = await resolveOptionalViewer(
      context.env.DB,
      context.req.header("Authorization"),
    );
    const view = await getLeagueStandingsView(context.env.DB, id, viewer);
    if (!view) return context.json(NOT_FOUND, 404);
    return context.json(view);
  });

  app.get("/universe/leaderboard", rateLimit, async (context) => {
    const pagination = resolvePagination(
      context.req.query("limit"),
      context.req.query("offset"),
    );
    return context.json(
      await getUniverseLeaderboard(context.env.DB, pagination),
    );
  });

  app.get("/seasons/current", rateLimit, async (context) => {
    return context.json(await getCurrentSeasonState(context.env.DB));
  });

  app.get("/openapi.json", (context) => context.json(openApiDocument));

  return app;
}
