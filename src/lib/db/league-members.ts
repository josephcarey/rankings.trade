/**
 * Typed query helpers for the `league_members` table.
 *
 * Membership is **temporal**: a row with `left_at = NULL` is an active
 * membership; leaving sets `left_at` rather than deleting the row, so a future
 * round finalization (Epic G) can freeze the active roster and archived rounds
 * stay stable. At most one active membership per agent per league is enforced by
 * a partial unique index (see migrations/0004_leagues.sql).
 *
 * Participants are agents; an agent may be unclaimed (no owner) and may be active
 * in multiple leagues at once. Forward-only pattern: no schema mutations here,
 * only DML.
 */

/** Full league-member record as stored in the database. */
export type LeagueMember = {
  id: number;
  league_id: number;
  agent_id: number;
  added_by_user_id: number | null;
  joined_at: string;
  left_at: string | null;
};

/** Fields for {@link addMember}. */
export type AddMemberInput = {
  league_id: number;
  agent_id: number;
  added_by_user_id?: number | null;
};

/**
 * Get the active (not-yet-left) membership for an agent in a league.
 *
 * @returns The active membership row, or null if the agent is not an active
 *   member.
 */
export async function getActiveMembership(
  db: D1Database,
  leagueId: number,
  agentId: number,
): Promise<LeagueMember | null> {
  const result = await db
    .prepare(
      "SELECT * FROM league_members WHERE league_id = ? AND agent_id = ? AND left_at IS NULL",
    )
    .bind(leagueId, agentId)
    .first<LeagueMember>();
  return result ?? null;
}

/**
 * Add an agent to a league as an active member.
 *
 * Idempotent: if the agent already has an active membership it is returned
 * unchanged (no duplicate row). An agent that previously left gets a fresh
 * membership interval.
 *
 * @returns The active membership row (existing or newly created).
 */
export async function addMember(
  db: D1Database,
  input: AddMemberInput,
): Promise<LeagueMember> {
  const existing = await getActiveMembership(db, input.league_id, input.agent_id);
  if (existing) return existing;

  const created = await db
    .prepare(
      `INSERT INTO league_members (league_id, agent_id, added_by_user_id)
       VALUES (?, ?, ?)
       RETURNING *`,
    )
    .bind(input.league_id, input.agent_id, input.added_by_user_id ?? null)
    .first<LeagueMember>();

  if (!created) {
    throw new Error("addMember: record not found after write");
  }
  return created;
}

/**
 * Mark an agent's active membership as left (sets `left_at`). Idempotent: if the
 * agent has no active membership, nothing changes.
 *
 * @returns The membership row after the update, or null if the agent had no
 *   active membership.
 */
export async function leaveMember(
  db: D1Database,
  leagueId: number,
  agentId: number,
): Promise<LeagueMember | null> {
  const active = await getActiveMembership(db, leagueId, agentId);
  if (!active) return null;

  await db
    .prepare("UPDATE league_members SET left_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(active.id)
    .run();

  const result = await db
    .prepare("SELECT * FROM league_members WHERE id = ?")
    .bind(active.id)
    .first<LeagueMember>();
  return result ?? null;
}

/**
 * List the active members of a league, oldest membership first.
 */
export async function listActiveMembers(
  db: D1Database,
  leagueId: number,
): Promise<LeagueMember[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM league_members
       WHERE league_id = ? AND left_at IS NULL
       ORDER BY joined_at ASC, id ASC`,
    )
    .bind(leagueId)
    .all<LeagueMember>();
  return results ?? [];
}

/**
 * Whether a user owns at least one agent that is an active member of a league.
 *
 * Backs private-league read access: a user may view a private league when they
 * own an active member agent. Unclaimed member agents (NULL owner) never match.
 */
export async function userOwnsActiveMember(
  db: D1Database,
  leagueId: number,
  userId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present
       FROM league_members m
       JOIN agents a ON a.id = m.agent_id
       WHERE m.league_id = ? AND m.left_at IS NULL AND a.owner_user_id = ?
       LIMIT 1`,
    )
    .bind(leagueId, userId)
    .first<{ present: number }>();
  return row?.present === 1;
}
