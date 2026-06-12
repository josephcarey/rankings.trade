import { fail, redirect } from "@sveltejs/kit";
import { message, setError, superValidate } from "sveltekit-superforms";
import { valibot } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";

import { claimAgent, listAgentsByOwner } from "../../lib/db/agents";
import { claimSchema } from "./agent-schema";

/**
 * Authed agents page load: an empty claim form plus the caller's owned agents.
 *
 * The route is guarded server-side (guard.ts authed prefixes); the `user` null
 * check is a defensive invariant — an authed request must carry a local user.
 */
export const load: PageServerLoad = async ({ locals, platform }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, "/sign-in");
  }

  const form = await superValidate(valibot(claimSchema));
  const db = platform?.env.DB;
  const agents = db ? await listAgentsByOwner(db, user.id) : [];

  return { form, agents };
};

export const actions: Actions = {
  default: async ({ locals, platform, request }) => {
    const form = await superValidate(request, valibot(claimSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    const db = platform?.env.DB;
    const { user } = locals;
    if (!db || !user) {
      return fail(500, { form });
    }

    const result = await claimAgent(db, form.data.symbol, user.id);
    switch (result.status) {
      case "already_claimed": {
        return setError(
          form,
          "symbol",
          "That callsign is already claimed by another user.",
          { status: 409 },
        );
      }
      case "already_owner": {
        return message(form, `You already own ${result.agent?.symbol}.`);
      }
      case "claimed": {
        return message(
          form,
          `Claimed ${result.agent?.symbol}. It's unverified until an admin reviews it.`,
        );
      }
      default: {
        return setError(form, "symbol", "That callsign isn't valid.", {
          status: 400,
        });
      }
    }
  },
};
