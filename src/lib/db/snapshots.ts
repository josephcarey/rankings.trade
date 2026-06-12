/**
 * Snapshot store — idempotent, chunked persistence of a round's agent snapshots
 * (Epic D, card #18).
 *
 * Writes go through `D1.batch()` in chunks that respect D1's 100-statement-per-batch
 * limit. Each row is an upsert keyed on the unique `(reset_date, observed_at,
 * agent_symbol)` triple, so re-running the same observation is a no-op on the key and
 * refreshes the metric columns — the scrape is safe to retry.
 */

import type { AgentSnapshotRow } from "./snapshots-types";

/** D1 rejects batches larger than 100 statements. */
export const D1_MAX_BATCH = 100;

const UPSERT_SQL = `INSERT INTO snapshots
    (reset_date, observed_at, agent_symbol, credits, credit_rank, total_agents, ship_count, faction)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(reset_date, observed_at, agent_symbol) DO UPDATE SET
    credits      = excluded.credits,
    credit_rank  = excluded.credit_rank,
    total_agents = excluded.total_agents,
    ship_count   = excluded.ship_count,
    faction      = excluded.faction`;

/**
 * Persist a batch of snapshot rows, chunked to respect D1's batch limit.
 *
 * @param db D1 database instance
 * @param rows Snapshot rows to upsert; an empty array is a no-op (no batch issued).
 */
export async function writeSnapshots(
  db: D1Database,
  rows: AgentSnapshotRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const upsert = db.prepare(UPSERT_SQL);
  const statements = rows.map((row) =>
    upsert.bind(
      row.reset_date,
      row.observed_at,
      row.agent_symbol,
      row.credits,
      row.credit_rank,
      row.total_agents,
      row.ship_count,
      row.faction,
    ),
  );

  for (let index = 0; index < statements.length; index += D1_MAX_BATCH) {
    await db.batch(statements.slice(index, index + D1_MAX_BATCH));
  }
}
