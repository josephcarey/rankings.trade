import type { Handler } from "hono";

import { getAuth } from "@hono/clerk-auth";
import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";
import type { AuthedVariables } from "./auth";

import { createErrorResponse } from "../errors";
import { transferAgentOwnership } from "../lib/agents/ownership-service";
import { isAdmin } from "../lib/auth/admin";
import { attachLocalUser, clerkAuth, requireAuth } from "./auth";

type AdminEnv = {
  Bindings: CloudflareBindings;
  Variables: AuthedVariables;
};

/** Studio error envelope for a non-admin caller. */
const FORBIDDEN = createErrorResponse("forbidden", "Admin access required.");

/**
 * Admin-only ownership transfer. Requires an authed Clerk session whose user id
 * is in the `ADMIN_CLERK_USER_IDS` allowlist; a non-admin (even authed) caller
 * gets 403.
 */
export const transferHandler: Handler<AdminEnv> = async (context) => {
  if (!isAdmin(getAuth(context)?.userId, context.env)) {
    return context.json(FORBIDDEN, 403);
  }

  const actor = context.get("user");
  const symbol = context.req.param("symbol") ?? "";
  const body = await context.req.json().catch(() => null);
  const newOwnerClerkId = typeof body?.newOwnerClerkId === "string" ? body.newOwnerClerkId : "";
  const reason = typeof body?.reason === "string" ? body.reason : null;

  const result = await transferAgentOwnership(context.env.DB, {
    actorUserId: actor.id,
    newOwnerClerkId,
    reason,
    symbol,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "agent_not_found":
      case "user_not_found": {
        return context.json(createErrorResponse(result.reason, "Not found."), 404);
      }
      case "conflict": {
        return context.json(
          createErrorResponse("conflict", "The agent's owner changed; retry."),
          409,
        );
      }
      default: {
        return context.json(
          createErrorResponse(result.reason, "Invalid transfer request."),
          400,
        );
      }
    }
  }

  return context.json({
    agent: result.value.agent,
    prior_owner_user_id: result.value.priorOwnerUserId,
    revoked_tokens: result.value.revokedTokens,
  });
};

/**
 * Builds the authed `/api/admin` router. The Clerk + local-user chain runs
 * first; per-route handlers enforce the admin allowlist.
 */
export function createAdminApi() {
  const app = new Hono<AdminEnv>();
  app.use("*", clerkAuth, requireAuth, attachLocalUser);
  app.post("/agents/:symbol/transfer", transferHandler);
  return app;
}
