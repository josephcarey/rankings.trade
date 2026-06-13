import type { Handler } from "hono";

import { Hono } from "hono";

import type { CloudflareBindings } from "../platform";
import type { AuthedVariables } from "./auth";

import { createErrorResponse } from "../errors";
import { transferAgentOwnership } from "../lib/agents/ownership-service";
import { isAdmin } from "../lib/auth/admin";
import {
  createSeason,
  listSeasons,
  updateSeason,
} from "../lib/seasons/season-service";
import { attachLocalUser, clerkAuth, getAuth, requireAuth } from "./auth";

type AdminEnv = {
  Bindings: CloudflareBindings;
  Variables: AuthedVariables;
};

/** Studio error envelope for a non-admin caller. */
const FORBIDDEN = createErrorResponse("forbidden", "Admin access required.");

/** Season-service failure reasons surfaced by the admin endpoints. */
type SeasonFailureReason =
  | "invalid_cutoff"
  | "invalid_gap"
  | "invalid_label"
  | "not_found"
  | "open_season_exists";

/** HTTP status for each season-service failure reason. */
const SEASON_FAILURE_STATUS: Record<SeasonFailureReason, number> = {
  invalid_cutoff: 400,
  invalid_gap: 400,
  invalid_label: 400,
  not_found: 404,
  open_season_exists: 409,
};

/** Human-readable copy for each season-service failure reason. */
const SEASON_FAILURE_MESSAGE: Record<SeasonFailureReason, string> = {
  invalid_cutoff: "Provide a valid cutoff date (YYYY-MM-DD).",
  invalid_gap: "The unranked gap must be a non-negative whole number of days.",
  invalid_label: "Provide a season label (1–100 characters).",
  not_found: "No open season with that id exists.",
  open_season_exists: "A season is already open. Close it before opening another.",
};

/** Parse a positive-integer route id, rejecting malformed input. */
function parseId(raw: string): null | number {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

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

/** Map a season-service failure to the studio error envelope + status. */
function seasonFailure(
  context: Parameters<Handler<AdminEnv>>[0],
  reason: SeasonFailureReason,
) {
  const envelope = createErrorResponse(reason, SEASON_FAILURE_MESSAGE[reason]);
  switch (SEASON_FAILURE_STATUS[reason]) {
    case 404: {
      return context.json(envelope, 404);
    }
    case 409: {
      return context.json(envelope, 409);
    }
    default: {
      return context.json(envelope, 400);
    }
  }
}

/** Admin-only: list every season, newest first. */
export const listSeasonsHandler: Handler<AdminEnv> = async (context) => {
  if (!isAdmin(getAuth(context)?.userId, context.env)) {
    return context.json(FORBIDDEN, 403);
  }
  return context.json({ seasons: await listSeasons(context.env.DB) });
};

/** Admin-only: open a new season (fails if one is already open). */
export const createSeasonHandler: Handler<AdminEnv> = async (context) => {
  if (!isAdmin(getAuth(context)?.userId, context.env)) {
    return context.json(FORBIDDEN, 403);
  }

  const body = await context.req.json().catch(() => null);
  const result = await createSeason(context.env.DB, {
    label: typeof body?.label === "string" ? body.label : "",
    cutoff_date: typeof body?.cutoff_date === "string" ? body.cutoff_date : "",
    unranked_gap_days:
      typeof body?.unranked_gap_days === "number" ? body.unranked_gap_days : undefined,
  });

  if (!result.ok) return seasonFailure(context, result.reason);
  return context.json({ season: result.value }, 201);
};

/** Admin-only: reconfigure the open season's cutoff and/or unranked gap. */
export const updateSeasonHandler: Handler<AdminEnv> = async (context) => {
  if (!isAdmin(getAuth(context)?.userId, context.env)) {
    return context.json(FORBIDDEN, 403);
  }

  const id = parseId(context.req.param("id") ?? "");
  if (id === null) return seasonFailure(context, "not_found");

  const body = await context.req.json().catch(() => null);
  const result = await updateSeason(context.env.DB, id, {
    cutoff_date: typeof body?.cutoff_date === "string" ? body.cutoff_date : undefined,
    unranked_gap_days:
      typeof body?.unranked_gap_days === "number" ? body.unranked_gap_days : undefined,
  });

  if (!result.ok) return seasonFailure(context, result.reason);
  return context.json({ season: result.value });
};

/**
 * Builds the authed `/api/admin` router. The Clerk + local-user chain runs
 * first; per-route handlers enforce the admin allowlist.
 */
export function createAdminApi() {
  const app = new Hono<AdminEnv>();
  app.use("*", clerkAuth, requireAuth, attachLocalUser);
  app.post("/agents/:symbol/transfer", transferHandler);
  app.get("/seasons", listSeasonsHandler);
  app.post("/seasons", createSeasonHandler);
  app.patch("/seasons/:id", updateSeasonHandler);
  return app;
}
