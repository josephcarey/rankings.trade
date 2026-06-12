import type { Handler } from "hono";

import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";
import type { AuthedVariables } from "./auth";

import { listAgentsByOwner } from "../lib/db/agents";
import { attachLocalUser, clerkAuth, requireAuth } from "./auth";

type AgentsEnv = {
  Bindings: CloudflareBindings;
  Variables: AuthedVariables;
};

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

/**
 * Builds the authed `/api/agents` router: every route requires a verified Clerk
 * session and a provisioned local user, mirroring the `/api/me` group.
 */
export function createAgentsApi() {
  const app = new Hono<AgentsEnv>();
  app.use("*", clerkAuth, requireAuth, attachLocalUser);
  app.get("/", ownedAgentsHandler);
  return app;
}
