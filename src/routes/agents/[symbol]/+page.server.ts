import { error, fail } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";

import {
  createAgentToken,
  listAgentTokens,
  parseTokenId,
  revokeAgentToken,
  rotateAgentToken,
} from "../../../lib/agents/token-service";
import { getAgentBySymbol, normalizeSymbol } from "../../../lib/db/agents";

/**
 * Resolve the local user and DB for an authed token-management request.
 *
 * The `/agents` prefix is guarded server-side, so a missing user/DB is a broken
 * invariant rather than an expected guest path.
 */
function context(locals: App.Locals, platform: App.Platform | undefined) {
  const user = locals.user;
  const db = platform?.env.DB;
  if (!user || !db) {
    error(500, "Agent token management is unavailable.");
  }
  return { db, userId: user.id };
}

/**
 * Load a caller-owned agent and its tokens. Unknown or non-owned callsigns
 * return 404 (indistinguishable) so ownership cannot be enumerated.
 */
export const load: PageServerLoad = async ({ locals, params, platform }) => {
  const { db, userId } = context(locals, platform);

  const result = await listAgentTokens(db, params.symbol, userId);
  if (!result.ok) {
    error(404, "Agent not found.");
  }

  const symbol = normalizeSymbol(params.symbol);
  const agent = await getAgentBySymbol(db, symbol);
  return {
    agent: { symbol: agent?.symbol ?? symbol, verified: agent?.verified ?? 0 },
    tokens: result.value,
  };
};

function tokenIdFromForm(value: FormDataEntryValue | null): number {
  const id = parseTokenId(typeof value === "string" ? value : "");
  if (id === null) {
    error(404, "Token not found.");
  }
  return id;
}

export const actions: Actions = {
  create: async ({ locals, params, platform, request }) => {
    const { db, userId } = context(locals, platform);
    const form = await request.formData();
    const raw = form.get("label");
    const label = typeof raw === "string" ? raw : "";

    const result = await createAgentToken(db, params.symbol, userId, label);
    if (!result.ok) {
      if (result.reason === "invalid_label") {
        return fail(400, { action: "create", error: "Label must be 1–60 characters." });
      }
      error(404, "Agent not found.");
    }

    return { created: result.value.view, secret: result.value.token };
  },

  revoke: async ({ locals, params, platform, request }) => {
    const { db, userId } = context(locals, platform);
    const form = await request.formData();
    const tokenId = tokenIdFromForm(form.get("tokenId"));

    const result = await revokeAgentToken(db, params.symbol, userId, tokenId);
    if (!result.ok) {
      error(404, "Token not found.");
    }
    return { revoked: result.value };
  },

  rotate: async ({ locals, params, platform, request }) => {
    const { db, userId } = context(locals, platform);
    const form = await request.formData();
    const tokenId = tokenIdFromForm(form.get("tokenId"));

    const result = await rotateAgentToken(db, params.symbol, userId, tokenId);
    if (!result.ok) {
      error(404, "Token not found.");
    }
    return { rotated: result.value.view, secret: result.value.token };
  },
};
