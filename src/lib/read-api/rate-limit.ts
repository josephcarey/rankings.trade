/**
 * In-memory fixed-window rate limiter for the public read API (Epic M).
 *
 * The read endpoints are READ-ONLY and may be hit anonymously, so — unlike Epic F's
 * per-token ingestion limiter, which persists counts in D1 — this limiter keeps NO
 * database state: a public read must never mutate a table. Counts live in a per-isolate
 * `Map`, reusing the pure fixed-window helpers from `../ingestion/rate-limit.ts`.
 *
 * Consequences of the per-isolate model (acceptable for advisory abuse-throttling, not a
 * strict global quota): counts are not shared across Cloudflare isolates and reset when an
 * isolate is recycled. The emitted `X-RateLimit-*` headers therefore reflect the budget seen
 * by the serving isolate. If real abuse appears, swap in a Durable Object / KV-backed counter
 * without changing the header contract or any handler.
 *
 * A single cleared-on-overflow `Map` bounds memory: when it exceeds {@link MAX_TRACKED_KEYS}
 * it is dropped wholesale (a one-window blip), rather than leaking entries for one-shot clients.
 */

import { retryAfterSeconds, windowIndex } from "../ingestion/rate-limit";

/** Default window length for public reads: one minute. */
const DEFAULT_WINDOW_MS = 60_000;

/** Default budget per client per window — deliberately generous for read traffic. */
const DEFAULT_PUBLIC_LIMIT = 120;

/** Hard cap on distinct tracked clients before the table is reset to bound memory. */
const MAX_TRACKED_KEYS = 10_000;

/** Tunable public-limiter configuration. */
export type PublicRateLimitConfig = {
  limit: number;
  windowMs: number;
};

/** The default public limiter configuration (120 requests / minute / client). */
const DEFAULT_PUBLIC_RATE_LIMIT_CONFIG: PublicRateLimitConfig = {
  limit: DEFAULT_PUBLIC_LIMIT,
  windowMs: DEFAULT_WINDOW_MS,
};

/** One rate-limit verdict plus the values needed for `X-RateLimit-*` headers. */
type RateLimitDecision = {
  /** False once the window's budget is exhausted. */
  allowed: boolean;
  /** The configured budget for the window. */
  limit: number;
  /** Requests remaining in the current window (never negative). */
  remaining: number;
  /** Seconds until the current window rolls over (the `Retry-After`/reset value). */
  resetSeconds: number;
};

/** A per-isolate limiter. {@link check} records a hit and returns the verdict. */
export type PublicRateLimiter = {
  check: (clientId: string, nowMs: number) => RateLimitDecision;
};

type Entry = { count: number; window: number };

/**
 * Build an in-memory fixed-window limiter. Each {@link PublicRateLimiter.check} call records
 * one hit for `clientId` in the window containing `nowMs` and returns the post-increment
 * verdict. A request that rolls into a new window resets the client's count to 1.
 */
export function createPublicRateLimiter(
  config: PublicRateLimitConfig = DEFAULT_PUBLIC_RATE_LIMIT_CONFIG,
): PublicRateLimiter {
  const { limit, windowMs } = config;
  let counts = new Map<string, Entry>();

  return {
    check(clientId, nowMs) {
      const window = windowIndex(nowMs, windowMs);

      if (counts.size > MAX_TRACKED_KEYS) {
        counts = new Map<string, Entry>();
      }

      const existing = counts.get(clientId);
      const count =
        existing && existing.window === window ? existing.count + 1 : 1;
      counts.set(clientId, { count, window });

      const resetSeconds = retryAfterSeconds(nowMs, windowMs);
      const remaining = Math.max(0, limit - count);
      return { allowed: count <= limit, limit, remaining, resetSeconds };
    },
  };
}
