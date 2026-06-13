import { error, fail } from "@sveltejs/kit";

import type { SeasonServiceResult } from "../../../lib/seasons/season-service";
import type { Actions, PageServerLoad } from "./$types";

import { isAdmin } from "../../../lib/auth/admin";
import {
  createSeason,
  listSeasons,
  updateSeason,
} from "../../../lib/seasons/season-service";

/** HTTP status to surface for each season failure reason. */
const FAILURE_STATUS: Record<string, number> = {
  invalid_cutoff: 400,
  invalid_gap: 400,
  invalid_label: 400,
  not_found: 404,
  open_season_exists: 409,
};

/** Human-readable copy for each season failure reason. */
const FAILURE_MESSAGE: Record<string, string> = {
  invalid_cutoff: "Provide a valid cutoff date (YYYY-MM-DD).",
  invalid_gap: "The unranked gap must be a non-negative whole number of days.",
  invalid_label: "Provide a season label (1–100 characters).",
  not_found: "No open season with that id exists.",
  open_season_exists: "A season is already open. Close it before opening another.",
};

/** Turn a failed service result into a SvelteKit `fail` with a friendly message. */
function failFor(result: Extract<SeasonServiceResult<unknown>, { ok: false }>) {
  return fail(FAILURE_STATUS[result.reason] ?? 400, {
    error: FAILURE_MESSAGE[result.reason] ?? "Invalid request.",
  });
}

/** Parse a whole-number day count from a form field, or undefined when blank. */
function parseGap(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return Number(raw);
}

/**
 * Admin-only load: invisible (404) to non-admins so the area cannot be probed. Returns the
 * season list (newest first) for the management table.
 */
export const load: PageServerLoad = async ({ locals, platform }) => {
  const env = platform?.env;
  if (!env || !isAdmin(locals.userId, env)) {
    error(404, "Not found.");
  }

  return { seasons: await listSeasons(env.DB) };
};

export const actions: Actions = {
  create: async ({ locals, platform, request }) => {
    const env = platform?.env;
    if (!env || !isAdmin(locals.userId, env)) {
      error(403, "Admin access required.");
    }

    const form = await request.formData();
    const result = await createSeason(env.DB, {
      label: String(form.get("label") ?? ""),
      cutoff_date: String(form.get("cutoff_date") ?? ""),
      unranked_gap_days: parseGap(form.get("unranked_gap_days")),
    });

    if (!result.ok) return failFor(result);
    return { created: { id: result.value.id, label: result.value.label } };
  },

  update: async ({ locals, platform, request }) => {
    const env = platform?.env;
    if (!env || !isAdmin(locals.userId, env)) {
      error(403, "Admin access required.");
    }

    const form = await request.formData();
    const rawId = form.get("id");
    const id = typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : 0;
    const cutoffRaw = form.get("cutoff_date");

    const result = await updateSeason(env.DB, id, {
      cutoff_date:
        typeof cutoffRaw === "string" && cutoffRaw.trim() !== "" ? cutoffRaw : undefined,
      unranked_gap_days: parseGap(form.get("unranked_gap_days")),
    });

    if (!result.ok) return failFor(result);
    return { updated: { id: result.value.id, label: result.value.label } };
  },
};
