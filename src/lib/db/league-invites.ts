/**
 * Typed query helpers for the `league_invites` table.
 *
 * Invites are **reusable** shareable join links: while an invite is active
 * (`revoked_at IS NULL`) any number of agents may join through it. Only the
 * SHA-256 hash of the secret token is stored (see `src/lib/leagues/invite-token.ts`);
 * acceptance hashes the presented token and looks up an active invite by hash.
 *
 * Revoke disables a link immediately. Rotate revokes the league's active links
 * and issues a fresh one, so the previous URL stops working. Forward-only
 * pattern: no schema mutations here, only DML.
 */

/** Full league-invite record as stored in the database. */
export type LeagueInvite = {
  id: number;
  league_id: number;
  token_hash: string;
  token_prefix: string;
  created_by_user_id: number;
  revoked_at: string | null;
  created_at: string;
};

/** Fields required to persist a freshly generated invite link. */
export type CreateInviteInput = {
  league_id: number;
  token_hash: string;
  token_prefix: string;
  created_by_user_id: number;
};

/**
 * Persist a new invite link (hash + prefix) for a league.
 */
export async function createInvite(
  db: D1Database,
  input: CreateInviteInput,
): Promise<LeagueInvite> {
  const created = await db
    .prepare(
      `INSERT INTO league_invites (league_id, token_hash, token_prefix, created_by_user_id)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(
      input.league_id,
      input.token_hash,
      input.token_prefix,
      input.created_by_user_id,
    )
    .first<LeagueInvite>();

  if (!created) {
    throw new Error("createInvite: record not found after write");
  }
  return created;
}

/**
 * Look up an **active** (non-revoked) invite by its stored token hash.
 *
 * @returns The active invite, or null when unknown or revoked.
 */
export async function findActiveInviteByHash(
  db: D1Database,
  hash: string,
): Promise<LeagueInvite | null> {
  const result = await db
    .prepare(
      "SELECT * FROM league_invites WHERE token_hash = ? AND revoked_at IS NULL",
    )
    .bind(hash)
    .first<LeagueInvite>();
  return result ?? null;
}

/**
 * List every invite (active and revoked) for a league, newest first.
 */
export async function listInvitesByLeague(
  db: D1Database,
  leagueId: number,
): Promise<LeagueInvite[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM league_invites WHERE league_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(leagueId)
    .all<LeagueInvite>();
  return results ?? [];
}

/**
 * Revoke a single invite, scoped to its league for authorization. Idempotent:
 * revoking an already-revoked invite leaves the original `revoked_at` unchanged.
 *
 * @returns The invite row after the update, or null if it does not belong to the
 *   given league.
 */
export async function revokeInvite(
  db: D1Database,
  id: number,
  leagueId: number,
): Promise<LeagueInvite | null> {
  await db
    .prepare(
      `UPDATE league_invites
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = ? AND league_id = ? AND revoked_at IS NULL`,
    )
    .bind(id, leagueId)
    .run();

  const result = await db
    .prepare("SELECT * FROM league_invites WHERE id = ? AND league_id = ?")
    .bind(id, leagueId)
    .first<LeagueInvite>();
  return result ?? null;
}

/**
 * Revoke all of a league's active invites.
 *
 * @returns The number of invites revoked.
 */
export async function revokeActiveInvitesForLeague(
  db: D1Database,
  leagueId: number,
): Promise<number> {
  const before = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM league_invites WHERE league_id = ? AND revoked_at IS NULL",
    )
    .bind(leagueId)
    .first<{ n: number }>();

  await db
    .prepare(
      `UPDATE league_invites
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE league_id = ? AND revoked_at IS NULL`,
    )
    .bind(leagueId)
    .run();

  return before?.n ?? 0;
}

/**
 * Rotate a league's invite link: revoke every active invite for the league and
 * issue one fresh invite. The caller supplies the new token's hash/prefix from
 * `generateInviteToken`. The previous URL stops working.
 *
 * @returns The newly created active invite.
 */
export async function rotateInvite(
  db: D1Database,
  input: CreateInviteInput,
): Promise<LeagueInvite> {
  await revokeActiveInvitesForLeague(db, input.league_id);
  return createInvite(db, input);
}
