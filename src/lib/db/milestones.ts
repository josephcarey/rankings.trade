/**
 * Typed query helpers for the `milestones` table (bot-ingested milestones).
 *
 * Milestones belong to an agent (Epic C) and are TOLERANT: any well-formed
 * `type` is stored, recognized or not. `metadata` is a canonical JSON string (or
 * NULL). Moderation is a SOFT-DELETE via `deleted_at`. Forward-only pattern: no
 * schema mutations here, only DML.
 */

/** Full milestone record as stored in the database. */
export type MilestoneRecord = {
  id: number;
  agent_id: number;
  ts: string;
  type: string;
  metadata: string | null;
  created_at: string;
  deleted_at: string | null;
  moderated_by_user_id: number | null;
  moderation_reason: string | null;
};

/**
 * Insert a milestone for an agent. `ts` is server-assigned (the row default).
 * `type` must already be normalized; `metadata` must be a canonical JSON string
 * or null (see src/lib/ingestion/validation.ts).
 *
 * @returns The newly created milestone row.
 */
export async function insertMilestone(
  db: D1Database,
  input: { agent_id: number; type: string; metadata: string | null },
): Promise<MilestoneRecord> {
  const created = await db
    .prepare(
      "INSERT INTO milestones (agent_id, type, metadata) VALUES (?, ?, ?) RETURNING *",
    )
    .bind(input.agent_id, input.type, input.metadata)
    .first<MilestoneRecord>();
  if (!created) throw new Error("insertMilestone: record not found after write");
  return created;
}

/** Fetch a single milestone row by id, regardless of soft-delete state. */
export async function getMilestoneById(
  db: D1Database,
  id: number,
): Promise<MilestoneRecord | null> {
  const row = await db
    .prepare("SELECT * FROM milestones WHERE id = ?")
    .bind(id)
    .first<MilestoneRecord>();
  return row ?? null;
}

/**
 * List an agent's non-deleted milestones, newest first.
 */
export async function listMilestonesByAgent(
  db: D1Database,
  agentId: number,
): Promise<MilestoneRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM milestones
       WHERE agent_id = ? AND deleted_at IS NULL
       ORDER BY ts DESC, id DESC`,
    )
    .bind(agentId)
    .all<MilestoneRecord>();
  return results ?? [];
}

/**
 * Soft-delete a milestone: stamp `deleted_at`, the moderator, and an optional
 * reason. Idempotent — an already-deleted row keeps its original metadata.
 *
 * @returns The row after the update, or null if the id is unknown.
 */
export async function softDeleteMilestone(
  db: D1Database,
  id: number,
  moderatorUserId: number,
  reason: string | null,
): Promise<MilestoneRecord | null> {
  await db
    .prepare(
      `UPDATE milestones
       SET deleted_at = CURRENT_TIMESTAMP,
           moderated_by_user_id = ?,
           moderation_reason = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(moderatorUserId, reason, id)
    .run();
  return getMilestoneById(db, id);
}
