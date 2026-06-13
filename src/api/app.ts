import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";
import type { AuthedVariables } from "./auth";

import { logger } from "../logger";
import { createAdminApi } from "./admin";
import { createAgentsApi } from "./agents";
import { attachLocalUser, clerkAuth, requireAuth } from "./auth";
import { createBotApi } from "./bot";
import { createIngestionApi } from "./ingestion";
import { createLeagueMilestoneTypesApi } from "./league-milestone-types";
import { createModerationApi } from "./moderation";

export const api = new Hono<{ Bindings: CloudflareBindings }>().basePath(
  "/api",
);

/**
 * Middleware that logs one canonical line per request:
 * method, path, status, duration, and any relevant IDs.
 */
api.use(async (context, next) => {
  const startTime = Date.now();
  const method = context.req.method;
  const path = context.req.path;

  await next();

  const duration = Date.now() - startTime;
  const status = context.res.status;

  logger.info("request", {
    method,
    path,
    status,
    duration,
  });
});

api.get("/health", (context) => context.json({ status: "ok" }));

/**
 * Authed API routes: every route mounted here requires a verified Clerk
 * session. Public API reads (leaderboard, public profiles) are mounted
 * directly on `api` and stay open — this guard is scoped to the authed class
 * only, never the whole `/api` surface.
 */
const authed = new Hono<{
  Bindings: CloudflareBindings;
  Variables: AuthedVariables;
}>();

authed.use("*", clerkAuth, requireAuth, attachLocalUser);

authed.get("/", (context) => context.json({ user: context.get("user") }));

api.route("/me", authed);

// Bot-token ingestion routes (POST /:symbol/logs|milestones) MUST be mounted
// before the Clerk-session agents router: their terminal handlers respond
// without falling through to the Clerk middleware that the agents router applies
// to every /agents/* request. See src/api/ingestion.ts and the routing tests.
api.route("/agents", createIngestionApi());

api.route("/agents", createAgentsApi());

api.route("/bot", createBotApi());

api.route("/admin", createAdminApi());

api.route("/leagues", createLeagueMilestoneTypesApi());

api.route("/moderation", createModerationApi());
