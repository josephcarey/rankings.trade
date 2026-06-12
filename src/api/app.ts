import { getAuth } from "@hono/clerk-auth";
import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";

import { logger } from "../logger";
import { clerkAuth, requireAuth } from "./auth";

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
const authed = new Hono<{ Bindings: CloudflareBindings }>();

authed.use("*", clerkAuth, requireAuth);

authed.get("/", (context) => context.json({ userId: getAuth(context)?.userId }));

api.route("/me", authed);
