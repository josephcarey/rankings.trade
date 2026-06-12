import { error, fail } from "@sveltejs/kit";

import type { TransferFailureReason } from "../../../../lib/agents/ownership-service";
import type { Actions, PageServerLoad } from "./$types";

import { transferAgentOwnership } from "../../../../lib/agents/ownership-service";
import { isAdmin } from "../../../../lib/auth/admin";
import { getAgentBySymbol, normalizeSymbol } from "../../../../lib/db/agents";

/** Human-readable copy for each transfer failure reason. */
const FAILURE_MESSAGE: Record<TransferFailureReason, string> = {
  agent_not_found: "No agent with that callsign exists.",
  conflict: "The agent's owner changed during the transfer. Reload and retry.",
  invalid_input: "Provide a target Clerk user id (and a reason under 500 characters).",
  unchanged: "That user already owns this agent.",
  user_not_found: "No local user matches that Clerk user id.",
};

/** HTTP status to surface for each transfer failure reason. */
const FAILURE_STATUS: Record<TransferFailureReason, number> = {
  agent_not_found: 404,
  conflict: 409,
  invalid_input: 400,
  unchanged: 400,
  user_not_found: 400,
};

/**
 * Admin-only load: invisible (404) to non-admins so the area cannot be probed.
 * Returns the agent for the transfer form.
 */
export const load: PageServerLoad = async ({ locals, params, platform }) => {
  const env = platform?.env;
  if (!env || !isAdmin(locals.userId, env)) {
    error(404, "Not found.");
  }

  const agent = await getAgentBySymbol(env.DB, normalizeSymbol(params.symbol));
  if (!agent) {
    error(404, "Agent not found.");
  }

  return {
    agent: {
      owner_user_id: agent.owner_user_id,
      symbol: agent.symbol,
      verified: agent.verified,
    },
  };
};

export const actions: Actions = {
  transfer: async ({ locals, params, platform, request }) => {
    const env = platform?.env;
    if (!env || !isAdmin(locals.userId, env)) {
      error(403, "Admin access required.");
    }

    const actor = locals.user;
    if (!actor) {
      error(403, "Admin access required.");
    }

    const form = await request.formData();
    const rawTarget = form.get("newOwnerClerkId");
    const rawReason = form.get("reason");
    const newOwnerClerkId = typeof rawTarget === "string" ? rawTarget : "";
    const reason = typeof rawReason === "string" ? rawReason : null;

    const result = await transferAgentOwnership(env.DB, {
      actorUserId: actor.id,
      newOwnerClerkId,
      reason,
      symbol: params.symbol,
    });

    if (!result.ok) {
      return fail(FAILURE_STATUS[result.reason], { error: FAILURE_MESSAGE[result.reason] });
    }

    return {
      transferred: {
        newOwnerUserId: result.value.agent.owner_user_id,
        revokedTokens: result.value.revokedTokens,
        symbol: result.value.agent.symbol,
      },
    };
  },
};
