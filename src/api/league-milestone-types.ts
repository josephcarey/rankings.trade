import type { Handler } from "hono";

import { Hono } from "hono";

import type { Actor } from "../lib/leagues/league-service";
import type { CloudflareBindings } from "../platform";
import type { AuthedVariables } from "./auth";

import { isAdmin } from "../lib/auth/admin";
import {
  listLeagueMilestoneTypesForActor,
  registerLeagueMilestoneType,
} from "../lib/ingestion/milestone-type-service";
import { createErrorResponse } from "../errors";
import { attachLocalUser, clerkAuth, getAuth, requireAuth } from "./auth";

type LeagueTypesEnv = {
  Bindings: CloudflareBindings;
  Variables: AuthedVariables;
};

const NOT_FOUND = createErrorResponse("not_found", "League not found.");

/** Parse a positive-integer route id, rejecting malformed input. */
function parseId(raw: string): null | number {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Resolve the acting user (and admin status) for a league-types request. */
function actorFor(context: Parameters<Handler<LeagueTypesEnv>>[0]): Actor {
  return {
    userId: context.get("user").id,
    isAdmin: isAdmin(getAuth(context)?.userId, context.env),
  };
}

/** List a league's custom milestone types (owner/admin only). */
export const listTypesHandler: Handler<LeagueTypesEnv> = async (context) => {
  const leagueId = parseId(context.req.param("id") ?? "");
  if (leagueId === null) return context.json(NOT_FOUND, 404);

  const result = await listLeagueMilestoneTypesForActor(
    context.env.DB,
    actorFor(context),
    leagueId,
  );
  if (!result.ok) return context.json(NOT_FOUND, 404);
  return context.json({ types: result.value });
};

/** Register a custom milestone type for a league (owner/admin only). */
export const registerTypeHandler: Handler<LeagueTypesEnv> = async (context) => {
  const leagueId = parseId(context.req.param("id") ?? "");
  if (leagueId === null) return context.json(NOT_FOUND, 404);

  const body = await context.req.json().catch(() => null);
  const key = body?.key;
  const label = typeof body?.label === "string" ? body.label : null;

  const result = await registerLeagueMilestoneType(
    context.env.DB,
    actorFor(context),
    leagueId,
    key,
    label,
  );
  if (!result.ok) {
    switch (result.reason) {
      case "invalid_type": {
        return context.json(
          createErrorResponse(
            "invalid_type",
            "Milestone type must be a slug of 1–80 lowercase characters.",
          ),
          400,
        );
      }
      case "duplicate": {
        return context.json(
          createErrorResponse("duplicate", "That milestone type already exists."),
          409,
        );
      }
      default: {
        return context.json(NOT_FOUND, 404);
      }
    }
  }
  return context.json({ type: result.value }, 201);
};

/**
 * Build the authed `/api/leagues` router for milestone-type management. The
 * Clerk + local-user chain runs first; the service enforces owner/admin authz.
 */
export function createLeagueMilestoneTypesApi() {
  const app = new Hono<LeagueTypesEnv>();
  app.use("*", clerkAuth, requireAuth, attachLocalUser);
  app.get("/:id/milestone-types", listTypesHandler);
  app.post("/:id/milestone-types", registerTypeHandler);
  return app;
}
