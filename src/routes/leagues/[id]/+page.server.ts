import { error, fail, redirect } from "@sveltejs/kit";
import { message, setError, superValidate } from "sveltekit-superforms";
import { valibot } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";

import { signInRedirect } from "../../../lib/auth/guard";
import { resolveActor } from "../../../lib/leagues/actor";
import {
  getViewableLeague,
  updateLeagueDetails,
} from "../../../lib/leagues/league-service";
import { leagueDetailsSchema } from "../league-schema";

/** Parse a route id param into a positive integer, or null when malformed. */
function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * League detail: viewable by anyone for a public league, and by the owner, an
 * admin, or a member-agent owner for a private league. Anything else 404s with
 * no existence leak. `canManage` gates the owner/admin management form.
 */
export const load: PageServerLoad = async ({ locals, params, platform }) => {
  const id = parseId(params.id);
  const db = platform?.env.DB;
  if (id === null || !db) {
    error(404, "League not found");
  }

  const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});
  const result = await getViewableLeague(db, actor, id);
  if (!result.ok) {
    error(404, "League not found");
  }

  const league = result.value;
  const canManage =
    actor !== null && (actor.isAdmin || league.owner_user_id === actor.userId);

  const form = await superValidate(
    {
      name: league.name,
      description: league.description ?? "",
      visibility: league.visibility,
    },
    valibot(leagueDetailsSchema),
  );

  return { canManage, form, league };
};

export const actions: Actions = {
  update: async ({ locals, params, platform, request }) => {
    const id = parseId(params.id);
    if (id === null) {
      error(404, "League not found");
    }

    const form = await superValidate(request, valibot(leagueDetailsSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    const db = platform?.env.DB;
    const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});
    if (!db) {
      return fail(500, { form });
    }
    if (!actor) {
      redirect(302, signInRedirect(`/leagues/${id}`));
    }

    const result = await updateLeagueDetails(db, actor, id, {
      name: form.data.name,
      description: form.data.description || null,
      visibility: form.data.visibility,
    });
    if (!result.ok) {
      if (result.reason === "invalid_name") {
        return setError(form, "name", "That league name isn't valid.", {
          status: 400,
        });
      }
      error(404, "League not found");
    }

    return message(form, "League updated.");
  },
};
