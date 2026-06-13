/**
 * Typed query helpers for the `milestone_types` registry.
 *
 * A GLOBAL default type has `league_id IS NULL` and is seeded in migration 0007
 * (DEC-4). A league may register additional LEAGUE-SCOPED custom types. Keys are
 * stored canonical (lowercase slug — see src/lib/ingestion/validation.ts) so
 * recognition is a string-equality check against stored milestone `type`s.
 *
 * Recognition is CONTEXT-AWARE (Epic J reads):
 * - a global/profile view recognizes GLOBAL defaults only;
 * - a league view additionally recognizes that league's custom types, and only
 *   when the agent is an ACTIVE member of that league.
 *
 * Forward-only pattern: no schema mutations here, only DML.
 */

/** A registered milestone type (global default or league-scoped custom). */
export type MilestoneType = {
  id: number;
  key: string;
  label: string | null;
  league_id: number | null;
  created_by_user_id: number | null;
  created_at: string;
};

/** List the global default milestone types, by key. */
export async function listGlobalMilestoneTypes(
  db: D1Database,
): Promise<MilestoneType[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM milestone_types WHERE league_id IS NULL ORDER BY key ASC",
    )
    .all<MilestoneType>();
  return results ?? [];
}

/** List a league's custom milestone types, by key. */
export async function listLeagueMilestoneTypes(
  db: D1Database,
  leagueId: number,
): Promise<MilestoneType[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM milestone_types WHERE league_id = ? ORDER BY key ASC",
    )
    .bind(leagueId)
    .all<MilestoneType>();
  return results ?? [];
}

/**
 * Register a custom milestone type for a league. Returns null on a duplicate key
 * within the league (the partial unique index rejects it).
 *
 * @returns The created type, or null if the (league_id, key) already exists.
 */
export async function insertLeagueMilestoneType(
  db: D1Database,
  input: {
    league_id: number;
    key: string;
    label: string | null;
    created_by_user_id: number;
  },
): Promise<MilestoneType | null> {
  const created = await db
    .prepare(
      `INSERT INTO milestone_types (key, label, league_id, created_by_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING
       RETURNING *`,
    )
    .bind(input.key, input.label, input.league_id, input.created_by_user_id)
    .first<MilestoneType>();
  return created ?? null;
}

/** True when `key` is a global default milestone type. */
export async function isGlobalMilestoneType(
  db: D1Database,
  key: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS present FROM milestone_types WHERE league_id IS NULL AND key = ? LIMIT 1",
    )
    .bind(key)
    .first<{ present: number }>();
  return row?.present === 1;
}

/**
 * Recognized milestone-type keys (with optional labels) for a LEAGUE view:
 * every global default plus that league's custom types. Returned as a map of
 * `key → label` (label may be null) so a feed can both test recognition
 * (`map.has(type)`) and prefer a curated label in O(1) per row.
 *
 * League custom types are recognized here because a league view only renders
 * its own active members' milestones, so the "agent is an active member"
 * condition of {@link isRecognizedType} already holds for every row.
 */
export async function recognizedTypesForLeague(
  db: D1Database,
  leagueId: number,
): Promise<Map<string, null | string>> {
  const { results } = await db
    .prepare(
      `SELECT key, label FROM milestone_types
       WHERE league_id IS NULL OR league_id = ?`,
    )
    .bind(leagueId)
    .all<{ key: string; label: null | string }>();
  return new Map((results ?? []).map((row) => [row.key, row.label]));
}

/**
 * Recognized milestone-type keys (with optional labels) for an AGENT PROFILE
 * view: every global default plus the custom types of the leagues the agent is
 * an ACTIVE member of — restricted to `visibleLeagueIds`, the leagues the
 * viewer is permitted to see.
 *
 * The restriction is a visibility safeguard: a public profile must not reveal
 * that a private league exists (or its curated custom-type labels) to a viewer
 * who could not otherwise see that league. Pass the agent's visible active
 * leagues; an empty list yields global defaults only.
 */
export async function recognizedTypesForAgent(
  db: D1Database,
  agentId: number,
  visibleLeagueIds: readonly number[],
): Promise<Map<string, null | string>> {
  const recognized = new Map<string, null | string>();

  const globals = await db
    .prepare("SELECT key, label FROM milestone_types WHERE league_id IS NULL")
    .all<{ key: string; label: null | string }>();
  for (const row of globals.results ?? []) recognized.set(row.key, row.label);

  if (visibleLeagueIds.length === 0) return recognized;

  const placeholders = visibleLeagueIds.map(() => "?").join(", ");
  const custom = await db
    .prepare(
      `SELECT mt.key AS key, mt.label AS label
       FROM milestone_types mt
       JOIN league_members lm
         ON lm.league_id = mt.league_id
        AND lm.agent_id = ?
        AND lm.left_at IS NULL
       WHERE mt.league_id IN (${placeholders})`,
    )
    .bind(agentId, ...visibleLeagueIds)
    .all<{ key: string; label: null | string }>();
  for (const row of custom.results ?? []) recognized.set(row.key, row.label);

  return recognized;
}

/**
 * Whether a milestone `type` is RECOGNIZED in a given context.
 *
 * - With no `leagueId`: recognized iff it is a global default.
 * - With a `leagueId`: recognized iff it is a global default, OR it is a custom
 *   type of that league AND `agentId` is an ACTIVE member of that league.
 */
export async function isRecognizedType(
  db: D1Database,
  type: string,
  agentId: number,
  leagueId?: number,
): Promise<boolean> {
  if (await isGlobalMilestoneType(db, type)) return true;
  if (leagueId === undefined) return false;

  const row = await db
    .prepare(
      `SELECT 1 AS present
       FROM milestone_types mt
       JOIN league_members lm
         ON lm.league_id = mt.league_id
        AND lm.agent_id = ?
        AND lm.left_at IS NULL
       WHERE mt.league_id = ? AND mt.key = ?
       LIMIT 1`,
    )
    .bind(agentId, leagueId, type)
    .first<{ present: number }>();
  return row?.present === 1;
}
