import { error, fail, redirect } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";

import { signInRedirect } from "../../../../lib/auth/guard";
import { listAgentsByOwner } from "../../../../lib/db/agents";
import { findActiveInviteByHash } from "../../../../lib/db/league-invites";
import { getLeagueById } from "../../../../lib/db/leagues";
import { resolveActor } from "../../../../lib/leagues/actor";
import { hashInviteToken } from "../../../../lib/leagues/invite-token";
import { acceptInvite } from "../../../../lib/leagues/league-service";

/**
 * Public invite-acceptance page. Reachable without authentication (so a shared
 * link prompts sign-in). The token is a bearer secret, so a holder may see the
 * target league's name and — once signed in — pick one of their own agents to
 * join. The actual membership write happens in the action.
 */
export const load: PageServerLoad = async ({ locals, params, platform }) => {
  const db = platform?.env.DB;
  if (!db) {
    error(500, "Invites are unavailable.");
  }

  const hash = await hashInviteToken(params.token.trim());
  const invite = await findActiveInviteByHash(db, hash);
  let leagueName: null | string = null;
  if (invite) {
    const league = await getLeagueById(db, invite.league_id);
    leagueName = league?.name ?? null;
  }

  const { user } = locals;
  const ownedAgents = user ? await listAgentsByOwner(db, user.id) : [];
  const agents = ownedAgents.map((agent) => ({
    id: agent.id,
    symbol: agent.symbol,
  }));

  return {
    agents,
    leagueName,
    signedIn: user !== null,
    valid: invite !== null,
  };
};

export const actions: Actions = {
  default: async ({ locals, params, platform, request }) => {
    const db = platform?.env.DB;
    const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});
    if (!db) {
      return fail(500, { error: "Invites are unavailable." });
    }
    if (!actor) {
      redirect(302, signInRedirect(`/leagues/join/${params.token}`));
    }

    const data = await request.formData();
    const agentId = Number(data.get("agentId"));
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return fail(400, { error: "Choose an agent to join with." });
    }

    const result = await acceptInvite(db, actor, params.token, agentId);
    if (!result.ok) {
      if (result.reason === "invalid_invite") {
        return fail(400, {
          error: "This invite link is invalid or has been revoked.",
        });
      }
      return fail(400, { error: "You can only join with an agent you own." });
    }

    redirect(303, `/leagues/${result.value.leagueId}`);
  },
};
