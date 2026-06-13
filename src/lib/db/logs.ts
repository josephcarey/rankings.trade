/**
 * Typed query helpers for the `logs` table (bot-ingested freeform log lines).
 *
 * Logs belong to an agent (Epic C). Moderation is a SOFT-DELETE: `deleted_at`
 * hides a row from reads while preserving it for audit. Forward-only pattern: no
 * schema mutations here, only DML.
 */

/** Full log record as stored in the database. */
export type LogRecord = {
  id: number;
  agent_id: number;
  ts: string;
  text: string;
  created_at: string;
  deleted_at: string | null;
  moderated_by_user_id: number | null;
  moderation_reason: string | null;
};

/**
 * Insert a freeform log line for an agent. `ts` is server-assigned (the row
 * default) so bots cannot backdate entries.
 *
 * @returns The newly created log row.
 */
export async function insertLog(
  db: D1Database,
  input: { agent_id: number; text: string },
): Promise<LogRecord> {
  const created = await db
    .prepare("INSERT INTO logs (agent_id, text) VALUES (?, ?) RETURNING *")
    .bind(input.agent_id, input.text)
    .first<LogRecord>();
  if (!created) throw new Error("insertLog: record not found after write");
  return created;
}

/** Fetch a single log row by id, regardless of soft-delete state. */
export async function getLogById(
  db: D1Database,
  id: number,
): Promise<LogRecord | null> {
  const row = await db
    .prepare("SELECT * FROM logs WHERE id = ?")
    .bind(id)
    .first<LogRecord>();
  return row ?? null;
}

/**
 * List an agent's non-deleted logs, newest first.
 */
export async function listLogsByAgent(
  db: D1Database,
  agentId: number,
): Promise<LogRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM logs
       WHERE agent_id = ? AND deleted_at IS NULL
       ORDER BY ts DESC, id DESC`,
    )
    .bind(agentId)
    .all<LogRecord>();
  return results ?? [];
}

/**
 * List recent non-deleted logs across a set of agents, newest first (read-only).
 * Backs a league activity feed without an N+1 per member. An empty agent set
 * issues no query.
 */
export async function listLogsByAgents(
  db: D1Database,
  agentIds: readonly number[],
  limit: number,
): Promise<LogRecord[]> {
  if (agentIds.length === 0) return [];
  const placeholders = agentIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT * FROM logs
       WHERE agent_id IN (${placeholders}) AND deleted_at IS NULL
       ORDER BY ts DESC, id DESC
       LIMIT ?`,
    )
    .bind(...agentIds, limit)
    .all<LogRecord>();
  return results ?? [];
}

/**
 * Soft-delete a log: stamp `deleted_at`, the moderator, and an optional reason.
 * Idempotent — an already-deleted row keeps its original moderation metadata.
 *
 * @returns The row after the update, or null if the id is unknown.
 */
export async function softDeleteLog(
  db: D1Database,
  id: number,
  moderatorUserId: number,
  reason: string | null,
): Promise<LogRecord | null> {
  await db
    .prepare(
      `UPDATE logs
       SET deleted_at = CURRENT_TIMESTAMP,
           moderated_by_user_id = ?,
           moderation_reason = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(moderatorUserId, reason, id)
    .run();
  return getLogById(db, id);
}
