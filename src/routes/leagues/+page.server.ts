import { fail, redirect } from "@sveltejs/kit";
import { setError, superValidate } from "sveltekit-superforms";
import { valibot } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";

import { signInRedirect } from "../../lib/auth/guard";
import { listLeaguesForUser } from "../../lib/db/leagues";
import { resolveActor } from "../../lib/leagues/actor";
import { createLeagueForActor } from "../../lib/leagues/league-service";
import { leagueDetailsSchema } from "./league-schema";

/**
 * Leagues home: an empty create form plus the leagues the caller should see —
 * leagues they own UNION leagues where they own an active member agent.
 *
 * `/leagues` is not in the auth-prefix guard (public league detail pages must be
 * reachable anonymously), so this load enforces sign-in itself.
 */
export const load: PageServerLoad = async ({ locals, platform }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, signInRedirect("/leagues"));
  }

  const form = await superValidate(valibot(leagueDetailsSchema));
  const db = platform?.env.DB;
  const leagues = db ? await listLeaguesForUser(db, user.id) : [];

  return { form, leagues };
};

export const actions: Actions = {
  default: async ({ locals, platform, request }) => {
    const form = await superValidate(request, valibot(leagueDetailsSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    const db = platform?.env.DB;
    const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});
    if (!db || !actor) {
      return fail(401, { form });
    }

    const result = await createLeagueForActor(db, actor, {
      name: form.data.name,
      description: form.data.description || null,
      visibility: form.data.visibility,
    });
    if (!result.ok) {
      return setError(form, "name", "That league name isn't valid.", {
        status: 400,
      });
    }

    redirect(303, `/leagues/${result.value.id}`);
  },
};
