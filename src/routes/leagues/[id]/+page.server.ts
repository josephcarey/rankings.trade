import { error, fail, redirect } from "@sveltejs/kit";
import { message, setError, superValidate } from "sveltekit-superforms";
import { valibot } from "sveltekit-superforms/adapters";

import type { Actions, PageServerLoad } from "./$types";

import { signInRedirect } from "../../../lib/auth/guard";
import { buildLineChart } from "../../../lib/charts/line-chart";
import {
  getLatestFinalizedLeagueRound,
  listLeagueCreditsSeries,
} from "../../../lib/db/credits";
import { listLogsByAgents } from "../../../lib/db/logs";
import { recognizedTypesForLeague } from "../../../lib/db/milestone-types";
import { listMilestonesByAgents } from "../../../lib/db/milestones";
import { listStandings } from "../../../lib/db/rounds";
import { resolveActor } from "../../../lib/leagues/actor";
import {
  addParticipant,
  createLeagueInvite,
  getViewableLeague,
  listLeagueInvites,
  listParticipants,
  removeParticipant,
  revokeLeagueInvite,
  rotateLeagueInvite,
  updateLeagueDetails,
} from "../../../lib/leagues/league-service";
import { describeMilestone } from "../../../lib/render/milestone";
import { leagueDetailsSchema } from "../league-schema";

/** Parse a route id param into a positive integer, or null when malformed. */
function parseId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Read a string form field, defaulting to empty. */
function field(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/** Build the shareable join URL for an invite token. */
function joinUrl(origin: string, token: string): string {
  return `${origin}/leagues/join/${token}`;
}

/**
 * League detail: viewable by anyone for a public league, and by the owner, an
 * admin, or a member-agent owner for a private league. Anything else 404s with
 * no existence leak. `canManage` gates the owner/admin management controls.
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

  const roster = await listParticipants(db, actor, id);
  const participants = roster.ok ? roster.value : [];

  // Read-only league views: standings (latest finalized league round), an
  // all-participants credits graph, and a recent milestone/log activity feed.
  // These reuse the same visibility gate as the roster above (a private
  // league's data only reaches here for an authorized viewer).
  const agentIds = participants.map((p) => p.agent_id);
  const symbolByAgent = new Map(participants.map((p) => [p.agent_id, p.symbol]));

  const latestRound = await getLatestFinalizedLeagueRound(db, id);
  const standingRows = latestRound
    ? await listStandings(db, latestRound.id, id)
    : [];
  const standings = standingRows.map((s) => ({
    credits: s.final_credits,
    participated: s.participated === 1,
    rank: s.final_rank,
    symbol: s.agent_symbol,
  }));

  const series = await listLeagueCreditsSeries(db, id, agentIds);
  const chart = buildLineChart(
    series.rounds.map((r) => r.reset_date),
    agentIds.map((aid) => ({
      label: symbolByAgent.get(aid) ?? "?",
      values: series.byAgent.get(aid) ?? [],
    })),
  );

  const recognized = await recognizedTypesForLeague(db, id);
  const milestoneRecords = await listMilestonesByAgents(db, agentIds, 50);
  const milestoneItems = milestoneRecords.map((m) => {
    const view = describeMilestone(m, recognized);
    return {
      fields: view.fields,
      kind: "milestone" as const,
      label: view.label,
      recognized: view.recognized,
      symbol: symbolByAgent.get(m.agent_id) ?? "?",
      ts: m.ts,
    };
  });
  const logRecords = await listLogsByAgents(db, agentIds, 50);
  const logItems = logRecords.map((l) => ({
    kind: "log" as const,
    symbol: symbolByAgent.get(l.agent_id) ?? "?",
    text: l.text,
    ts: l.ts,
  }));
  const activity = [...milestoneItems, ...logItems]
    .toSorted((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 50);

  let invites: { created_at: string; id: number; revoked_at: null | string; token_prefix: string }[] =
    [];
  if (canManage && actor) {
    const result = await listLeagueInvites(db, actor, id);
    if (result.ok) {
      invites = result.value.map((invite) => ({
        created_at: invite.created_at,
        id: invite.id,
        revoked_at: invite.revoked_at,
        token_prefix: invite.token_prefix,
      }));
    }
  }

  const form = await superValidate(
    {
      name: league.name,
      description: league.description ?? "",
      visibility: league.visibility,
    },
    valibot(leagueDetailsSchema),
  );

  return { canManage, chart, activity, form, invites, league, participants, standings, standingsRound: latestRound?.reset_date ?? null };
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

  addParticipant: async ({ locals, params, platform, request }) => {
    const id = parseId(params.id);
    if (id === null) {
      error(404, "League not found");
    }

    const db = platform?.env.DB;
    const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});
    if (!db) {
      return fail(500, { action: "addParticipant", error: "Unavailable." });
    }
    if (!actor) {
      redirect(302, signInRedirect(`/leagues/${id}`));
    }

    const data = await request.formData();
    const symbol = field(data.get("symbol"));
    const result = await addParticipant(db, actor, id, symbol);
    if (!result.ok) {
      if (result.reason === "invalid_symbol") {
        return fail(400, {
          action: "addParticipant",
          error: "Enter a valid callsign (3–20 characters).",
        });
      }
      error(404, "League not found");
    }

    return { action: "addParticipant", added: result.value };
  },

  removeParticipant: async ({ locals, params, platform, request }) => {
    const id = parseId(params.id);
    if (id === null) {
      error(404, "League not found");
    }

    const db = platform?.env.DB;
    const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});
    if (!db) {
      return fail(500, { action: "removeParticipant", error: "Unavailable." });
    }
    if (!actor) {
      redirect(302, signInRedirect(`/leagues/${id}`));
    }

    const data = await request.formData();
    const symbol = field(data.get("symbol"));
    const result = await removeParticipant(db, actor, id, symbol);
    if (!result.ok) {
      error(404, "League not found");
    }

    return { action: "removeParticipant", removed: result.value };
  },

  createInvite: async ({ locals, params, platform, url }) => {
    const id = parseId(params.id);
    if (id === null) {
      error(404, "League not found");
    }

    const db = platform?.env.DB;
    const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});
    if (!db) {
      return fail(500, { action: "createInvite", error: "Unavailable." });
    }
    if (!actor) {
      redirect(302, signInRedirect(`/leagues/${id}`));
    }

    const result = await createLeagueInvite(db, actor, id);
    if (!result.ok) {
      error(404, "League not found");
    }

    return {
      action: "createInvite",
      joinUrl: joinUrl(url.origin, result.value.token),
    };
  },

  rotateInvite: async ({ locals, params, platform, url }) => {
    const id = parseId(params.id);
    if (id === null) {
      error(404, "League not found");
    }

    const db = platform?.env.DB;
    const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});
    if (!db) {
      return fail(500, { action: "rotateInvite", error: "Unavailable." });
    }
    if (!actor) {
      redirect(302, signInRedirect(`/leagues/${id}`));
    }

    const result = await rotateLeagueInvite(db, actor, id);
    if (!result.ok) {
      error(404, "League not found");
    }

    return {
      action: "rotateInvite",
      joinUrl: joinUrl(url.origin, result.value.token),
    };
  },

  revokeInvite: async ({ locals, params, platform, request }) => {
    const id = parseId(params.id);
    if (id === null) {
      error(404, "League not found");
    }

    const db = platform?.env.DB;
    const actor = resolveActor(locals.user, locals.userId, platform?.env ?? {});
    if (!db) {
      return fail(500, { action: "revokeInvite", error: "Unavailable." });
    }
    if (!actor) {
      redirect(302, signInRedirect(`/leagues/${id}`));
    }

    const data = await request.formData();
    const inviteId = Number(field(data.get("inviteId")));
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      error(404, "Invite not found");
    }

    const result = await revokeLeagueInvite(db, actor, id, inviteId);
    if (!result.ok) {
      error(404, "Invite not found");
    }

    return { action: "revokeInvite", revoked: result.value.id };
  },
};
