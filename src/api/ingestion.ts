import type { Context } from "hono";

import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";
import type { BotVariables } from "./bot-auth";

import { createErrorResponse } from "../errors";
import { normalizeSymbol } from "../lib/db/agents";
import {
  enforceRateLimit,
  MAX_BODY_BYTES,
  submitLog,
  submitMilestone,
} from "../lib/ingestion/ingestion-service";
import { requireAgentToken } from "./bot-auth";

type IngestionEnv = {
  Bindings: CloudflareBindings;
  Variables: BotVariables;
};

export type { IngestionEnv };

/** Studio error envelope for a token used against a callsign it does not own. */
const SYMBOL_MISMATCH = createErrorResponse(
  "forbidden",
  "This token may not post for that agent.",
);

/** Studio error envelope for an over-cap request body. */
const BODY_TOO_LARGE = createErrorResponse(
  "payload_too_large",
  `Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`,
);

/** Studio error envelope for an unparseable JSON body. */
const INVALID_JSON = createErrorResponse(
  "invalid_json",
  "Request body must be valid JSON.",
);

/**
 * Confirm the path `:symbol` matches the token's authenticated agent. A token
 * scopes to exactly one agent (Epic C), so this blocks using agent A's token to
 * post content as agent B (IDOR).
 */
function symbolMatchesAgent(context: Context<IngestionEnv>): boolean {
  const param = normalizeSymbol(context.req.param("symbol") ?? "");
  return param === context.get("agent").symbol;
}

/**
 * Read the request body subject to the size cap and parse it as JSON.
 *
 * Rejects early on an over-cap `Content-Length`, then enforces the actual byte
 * length after reading (the header can be absent or untrustworthy).
 */
async function readCappedJson(
  context: Context<IngestionEnv>,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 }
> {
  const declared = context.req.header("Content-Length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return { ok: false, status: 413 };
  }

  const raw = await context.req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return { ok: false, status: 413 };
  }

  try {
    return { ok: true, value: raw.length === 0 ? {} : JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** Map an ingestion validation failure reason to its error envelope. */
function validationError(reason: "invalid_metadata" | "invalid_text" | "invalid_type") {
  const messages = {
    invalid_text: "Log text must be 1–2000 characters.",
    invalid_type: "Milestone type must be a slug of 1–80 lowercase characters.",
    invalid_metadata: "Milestone metadata must be a small JSON object.",
  } as const;
  return createErrorResponse(reason, messages[reason]);
}

/**
 * Build the bot-token ingestion router.
 *
 * Mounted at `/api/agents` BEFORE the Clerk-session agents router. Its routes
 * are terminal (they always respond), so the Clerk middleware registered by the
 * later router never runs for a bot POST (verified by routing tests). Every route
 * requires a per-agent Bearer token; the path `:symbol` must match that token's
 * agent.
 *
 * Per-request order: auth → symbol match → rate limit → body-size cap → parse →
 * validate → persist.
 *
 * @param deps.now - Clock injection for the rate limiter (defaults to wall clock).
 */
export function createIngestionApi(deps: { now?: () => Date } = {}) {
  const now = deps.now ?? (() => new Date());
  const app = new Hono<IngestionEnv>();

  async function guard(
    context: Context<IngestionEnv>,
  ): Promise<null | Response> {
    if (!symbolMatchesAgent(context)) {
      return context.json(SYMBOL_MISMATCH, 403);
    }
    const decision = await enforceRateLimit(
      context.env.DB,
      context.get("token").id,
      now().getTime(),
    );
    if (!decision.allowed) {
      context.header("Retry-After", String(decision.retryAfter));
      return context.json(
        createErrorResponse("rate_limited", "Too many requests."),
        429,
      );
    }
    return null;
  }

  app.post("/:symbol/logs", requireAgentToken, async (context) => {
    const blocked = await guard(context);
    if (blocked) return blocked;

    const body = await readCappedJson(context);
    if (!body.ok) {
      return context.json(body.status === 413 ? BODY_TOO_LARGE : INVALID_JSON, body.status);
    }

    const text = (body.value as { text?: unknown })?.text;
    const result = await submitLog(context.env.DB, context.get("agent").id, text);
    if (!result.ok) return context.json(validationError(result.reason), 400);
    return context.json({ log: result.value }, 201);
  });

  app.post("/:symbol/milestones", requireAgentToken, async (context) => {
    const blocked = await guard(context);
    if (blocked) return blocked;

    const body = await readCappedJson(context);
    if (!body.ok) {
      return context.json(body.status === 413 ? BODY_TOO_LARGE : INVALID_JSON, body.status);
    }

    const payload = body.value as { type?: unknown; metadata?: unknown };
    const result = await submitMilestone(context.env.DB, context.get("agent").id, {
      type: payload?.type,
      metadata: payload?.metadata,
    });
    if (!result.ok) return context.json(validationError(result.reason), 400);
    return context.json({ milestone: result.value }, 201);
  });

  return app;
}
