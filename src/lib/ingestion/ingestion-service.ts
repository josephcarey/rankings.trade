/**
 * Ingestion service: the tested logic behind the bot logs/milestones endpoints.
 *
 * Composes validation (src/lib/ingestion/validation.ts), the fixed-window rate
 * limiter, and the logs/milestones persistence helpers. The Hono handlers
 * (src/api/ingestion.ts) stay thin: resolve the authenticated agent/token, then
 * delegate here.
 *
 * MILESTONES ARE TOLERANT: an unrecognized but well-formed `type` is stored, not
 * rejected. Only malformed input (bad text/type/metadata shape) is refused.
 */

import type { LogRecord } from "../db/logs";
import type { MilestoneRecord } from "../db/milestones";
import type { RateLimitConfig } from "./rate-limit";

import { recordTokenHit } from "../db/ingestion-rate";
import { insertLog } from "../db/logs";
import { insertMilestone } from "../db/milestones";
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  isWithinLimit,
  retryAfterSeconds,
  windowIndex,
} from "./rate-limit";
import {
  validateLogText,
  validateMetadata,
  validateMilestoneType,
} from "./validation";

/**
 * Max accepted request-body size for an ingestion endpoint. Cheap protection
 * against a leaked token spraying oversized payloads. Field-level caps in
 * validation.ts are the finer-grained limits.
 */
export const MAX_BODY_BYTES = 16_384;

/** Discriminated result for an ingestion write. */
export type IngestResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "invalid_metadata" | "invalid_text" | "invalid_type" };

/**
 * Validate and store a freeform log line for an agent. `ts` is server-assigned.
 */
export async function submitLog(
  db: D1Database,
  agentId: number,
  rawText: unknown,
): Promise<IngestResult<LogRecord>> {
  const text = validateLogText(rawText);
  if (!text.ok) return text;
  const log = await insertLog(db, { agent_id: agentId, text: text.value });
  return { ok: true, value: log };
}

/** Input for {@link submitMilestone}. */
export type MilestoneInput = {
  type: unknown;
  metadata?: unknown;
};

/**
 * Validate and store a milestone for an agent. The `type` is normalized to its
 * canonical key and accepted whether or not it is a recognized type (tolerant).
 * `metadata`, when present, must be a plain JSON object within the size/depth
 * caps and is stored as canonical JSON.
 */
export async function submitMilestone(
  db: D1Database,
  agentId: number,
  input: MilestoneInput,
): Promise<IngestResult<MilestoneRecord>> {
  const type = validateMilestoneType(input.type);
  if (!type.ok) return type;

  const metadata = validateMetadata(input.metadata);
  if (!metadata.ok) return metadata;

  const milestone = await insertMilestone(db, {
    agent_id: agentId,
    type: type.value,
    metadata: metadata.value,
  });
  return { ok: true, value: milestone };
}

/** The outcome of a per-token rate-limit check. */
export type RateDecision = {
  allowed: boolean;
  count: number;
  /** Seconds until the window resets — surfaced as `Retry-After` on a 429. */
  retryAfter: number;
};

/**
 * Record one hit for `tokenId` and decide whether it is within the limit, using
 * a single atomic counter write. Clock is injected via `nowMs` for testability.
 */
export async function enforceRateLimit(
  db: D1Database,
  tokenId: number,
  nowMs: number,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
): Promise<RateDecision> {
  const index = windowIndex(nowMs, config.windowMs);
  const count = await recordTokenHit(db, tokenId, index);
  return {
    allowed: isWithinLimit(count, config.limit),
    count,
    retryAfter: retryAfterSeconds(nowMs, config.windowMs),
  };
}
