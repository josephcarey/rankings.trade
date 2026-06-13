/**
 * D1 access for the per-token fixed-window rate limiter.
 *
 * A single atomic UPSERT both records the hit and returns the running count for
 * the current window, so concurrent requests cannot double-count or lose a write
 * between a separate read and write. `window_start` holds the window INDEX (see
 * src/lib/ingestion/rate-limit.ts); when the stored index is older than the
 * current one the counter resets to 1.
 *
 * Forward-only pattern: no schema mutations here, only DML.
 */

/**
 * Record one ingestion hit for `tokenId` in window `windowIndex` and return the
 * resulting count within that window.
 *
 * The UPSERT increments when the stored window matches the current one, otherwise
 * it rolls the row over to the new window with count 1 — all in one statement.
 *
 * @returns The post-increment request count for the current window (>= 1).
 */
export async function recordTokenHit(
  db: D1Database,
  tokenId: number,
  windowIndex: number,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO ingestion_rate_limits (token_id, window_start, count)
       VALUES (?1, ?2, 1)
       ON CONFLICT(token_id) DO UPDATE SET
         count = CASE
           WHEN ingestion_rate_limits.window_start = ?2
           THEN ingestion_rate_limits.count + 1
           ELSE 1
         END,
         window_start = ?2
       RETURNING count`,
    )
    .bind(tokenId, windowIndex)
    .first<{ count: number }>();
  return row?.count ?? 1;
}
