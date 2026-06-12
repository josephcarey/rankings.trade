import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";
import { logger } from "../logger";

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
