import { fail, redirect } from "@sveltejs/kit";
import { message, superValidate } from "sveltekit-superforms";
import { valibot } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";

import { updateUserProfile } from "../../lib/db/users";
import { profileSchema, toDashboardUrl } from "./profile-schema";

/**
 * Authed profile settings load: seeds the superform with the current user's
 * persisted visibility and dashboard link.
 *
 * The route is already guarded server-side (card #11); the `user` null check is
 * a defensive invariant — an authed request must carry a resolved local user.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, "/sign-in");
  }

  const form = await superValidate(
    { dashboard_url: user.dashboard_url ?? "", visibility: user.visibility },
    valibot(profileSchema),
  );

  return { form };
};

export const actions: Actions = {
  default: async ({ locals, platform, request }) => {
    const form = await superValidate(request, valibot(profileSchema));
    if (!form.valid) {
      return fail(400, { form });
    }

    const db = platform?.env.DB;
    const { userId } = locals;
    if (!db || !userId) {
      return fail(500, { form });
    }

    const updated = await updateUserProfile(db, userId, {
      dashboard_url: toDashboardUrl(form.data.dashboard_url),
      visibility: form.data.visibility,
    });
    if (!updated) {
      return fail(404, { form });
    }

    return message(form, "Profile updated.");
  },
};
