/**
 * Pure helpers for the per-token fixed-window rate limiter.
 *
 * No database access. The window for a moment in time is identified by an integer
 * INDEX (`floor(now_ms / window_ms)`), so two requests fall in the same window
 * iff they share an index. The D1 counter keyed by that index lives in
 * src/lib/db/ingestion-rate.ts.
 *
 * A fixed window can admit a short burst across a boundary (up to ~2× the limit);
 * that is acceptable for v1 bot-abuse protection. If real abuse appears, swap in a
 * sliding window or token bucket without touching the schema.
 */

/** Default window length: one minute. */
const DEFAULT_WINDOW_MS = 60_000;

/** Default max ingestion requests per token per window. */
const DEFAULT_RATE_LIMIT = 60;

/** Tunable limiter configuration. */
export type RateLimitConfig = {
  windowMs: number;
  limit: number;
};

/** The default limiter configuration (60 requests / minute / token). */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: DEFAULT_WINDOW_MS,
  limit: DEFAULT_RATE_LIMIT,
};

/** The integer index of the fixed window containing `nowMs`. */
export function windowIndex(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs);
}

/** Seconds until the current window rolls over — the `Retry-After` value. */
export function retryAfterSeconds(nowMs: number, windowMs: number): number {
  const remaining = windowMs - (nowMs % windowMs);
  return Math.max(1, Math.ceil(remaining / 1000));
}

/** True when a post-increment `count` is within the configured limit. */
export function isWithinLimit(count: number, limit: number): boolean {
  return count <= limit;
}
