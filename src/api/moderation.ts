import type { Handler } from "hono";

import { Hono } from "hono";

import type { Actor } from "../lib/leagues/league-service";
import type { CloudflareBindings } from "../platform";
import type { AuthedVariables } from "./auth";

import { isAdmin } from "../lib/auth/admin";
import {
  deleteLog,
  deleteMilestone,
  listAgentLogsForModerator,
  listAgentMilestonesForModerator,
} from "../lib/ingestion/moderation-service";
import { createErrorResponse } from "../errors";
import { attachLocalUser, clerkAuth, getAuth, requireAuth } from "./auth";

type ModerationEnv = {
  Bindings: CloudflareBindings;
  Variables: AuthedVariables;
};

const NOT_FOUND = createErrorResponse("not_found", "Not found.");

/** Parse a positive-integer route id, rejecting malformed input. */
function parseId(raw: string): null | number {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Resolve the acting user (and admin status) for a moderation request. */
function actorFor(context: Parameters<Handler<ModerationEnv>>[0]): Actor {
  return {
    userId: context.get("user").id,
    isAdmin: isAdmin(getAuth(context)?.userId, context.env),
  };
}

/** Read an optional `reason` string from the request body. */
async function reasonFrom(
  context: Parameters<Handler<ModerationEnv>>[0],
): Promise<null | string> {
  const body = await context.req.json().catch(() => null);
  return typeof body?.reason === "string" ? body.reason : null;
}

/** Soft-delete a log by id (owner/admin only, IDOR-safe). */
export const deleteLogHandler: Handler<ModerationEnv> = async (context) => {
  const id = parseId(context.req.param("id") ?? "");
  if (id === null) return context.json(NOT_FOUND, 404);

  const result = await deleteLog(context.env.DB, actorFor(context), id, await reasonFrom(context));
  if (!result.ok) return context.json(NOT_FOUND, 404);
  return context.json({ log: result.value });
};

/** Soft-delete a milestone by id (owner/admin only, IDOR-safe). */
export const deleteMilestoneHandler: Handler<ModerationEnv> = async (context) => {
  const id = parseId(context.req.param("id") ?? "");
  if (id === null) return context.json(NOT_FOUND, 404);

  const result = await deleteMilestone(
    context.env.DB,
    actorFor(context),
    id,
    await reasonFrom(context),
  );
  if (!result.ok) return context.json(NOT_FOUND, 404);
  return context.json({ milestone: result.value });
};

/** List an agent's non-deleted logs for a moderator. */
export const listLogsHandler: Handler<ModerationEnv> = async (context) => {
  const symbol = context.req.param("symbol") ?? "";
  const result = await listAgentLogsForModerator(context.env.DB, actorFor(context), symbol);
  if (!result.ok) return context.json(NOT_FOUND, 404);
  return context.json({ logs: result.value });
};

/** List an agent's non-deleted milestones for a moderator. */
export const listMilestonesHandler: Handler<ModerationEnv> = async (context) => {
  const symbol = context.req.param("symbol") ?? "";
  const result = await listAgentMilestonesForModerator(context.env.DB, actorFor(context), symbol);
  if (!result.ok) return context.json(NOT_FOUND, 404);
  return context.json({ milestones: result.value });
};

/**
 * Build the authed `/api/moderation` router. The Clerk + local-user chain runs
 * first; the service enforces owner/admin authority and collapses unauthorized
 * or unknown targets to `not_found`.
 */
export function createModerationApi() {
  const app = new Hono<ModerationEnv>();
  app.use("*", clerkAuth, requireAuth, attachLocalUser);
  app.get("/agents/:symbol/logs", listLogsHandler);
  app.get("/agents/:symbol/milestones", listMilestonesHandler);
  app.delete("/logs/:id", deleteLogHandler);
  app.delete("/milestones/:id", deleteMilestoneHandler);
  return app;
}
