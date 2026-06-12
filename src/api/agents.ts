import type { Handler } from "hono";

import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";
import type { AuthedVariables } from "./auth";

import { createErrorResponse } from "../errors";
import {
  createAgentToken,
  listAgentTokens,
  parseTokenId,
  revokeAgentToken,
  rotateAgentToken,
} from "../lib/agents/token-service";
import { listAgentsByOwner } from "../lib/db/agents";
import { attachLocalUser, clerkAuth, requireAuth } from "./auth";

type AgentsEnv = {
  Bindings: CloudflareBindings;
  Variables: AuthedVariables;
};

const NOT_FOUND = createErrorResponse("not_found", "Agent not found.");

/**
 * Lists the authenticated caller's owned agents.
 *
 * Must run after the auth chain (which guarantees a resolved local `user`).
 */
export const ownedAgentsHandler: Handler<AgentsEnv> = async (context) => {
  const user = context.get("user");
  const agents = await listAgentsByOwner(context.env.DB, user.id);
  return context.json({ agents });
};

/** Lists the non-secret token views for one of the caller's agents. */
export const listTokensHandler: Handler<AgentsEnv> = async (context) => {
  const user = context.get("user");
  const symbol = context.req.param("symbol") ?? "";
  const result = await listAgentTokens(context.env.DB, symbol, user.id);
  if (!result.ok) return context.json(NOT_FOUND, 404);
  return context.json({ tokens: result.value });
};

/** Creates a token for one of the caller's agents; the raw secret is shown once. */
export const createTokenHandler: Handler<AgentsEnv> = async (context) => {
  const user = context.get("user");
  const symbol = context.req.param("symbol") ?? "";

  const body = await context.req.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label : "";

  const result = await createAgentToken(context.env.DB, symbol, user.id, label);
  if (!result.ok) {
    if (result.reason === "invalid_label") {
      return context.json(
        createErrorResponse("invalid_label", "Label must be 1-60 characters."),
        400,
      );
    }
    return context.json(NOT_FOUND, 404);
  }

  return context.json(
    { record: result.value.view, token: result.value.token },
    201,
  );
};

/** Revokes one of the caller's agent tokens. */
export const revokeTokenHandler: Handler<AgentsEnv> = async (context) => {
  const user = context.get("user");
  const symbol = context.req.param("symbol") ?? "";
  const tokenId = parseTokenId(context.req.param("id") ?? "");
  if (tokenId === null) return context.json(NOT_FOUND, 404);

  const result = await revokeAgentToken(context.env.DB, symbol, user.id, tokenId);
  if (!result.ok) return context.json(NOT_FOUND, 404);
  return context.json({ record: result.value });
};

/** Rotates one of the caller's agent tokens; the new raw secret is shown once. */
export const rotateTokenHandler: Handler<AgentsEnv> = async (context) => {
  const user = context.get("user");
  const symbol = context.req.param("symbol") ?? "";
  const tokenId = parseTokenId(context.req.param("id") ?? "");
  if (tokenId === null) return context.json(NOT_FOUND, 404);

  const result = await rotateAgentToken(context.env.DB, symbol, user.id, tokenId);
  if (!result.ok) return context.json(NOT_FOUND, 404);
  return context.json(
    { record: result.value.view, token: result.value.token },
    201,
  );
};

/**
 * Builds the authed `/api/agents` router: every route requires a verified Clerk
 * session and a provisioned local user, mirroring the `/api/me` group.
 */
export function createAgentsApi() {
  const app = new Hono<AgentsEnv>();
  app.use("*", clerkAuth, requireAuth, attachLocalUser);
  app.get("/", ownedAgentsHandler);
  app.get("/:symbol/tokens", listTokensHandler);
  app.post("/:symbol/tokens", createTokenHandler);
  app.post("/:symbol/tokens/:id/revoke", revokeTokenHandler);
  app.post("/:symbol/tokens/:id/rotate", rotateTokenHandler);
  return app;
}
