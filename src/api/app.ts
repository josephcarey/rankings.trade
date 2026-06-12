import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";

export const api = new Hono<{ Bindings: CloudflareBindings }>().basePath(
  "/api",
);

api.get("/health", (context) => context.json({ status: "ok" }));
