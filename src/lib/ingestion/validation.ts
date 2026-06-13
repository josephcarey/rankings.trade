/**
 * Pure validation + normalization for bot-ingested logs and milestones.
 *
 * No database access. Shared by the ingestion service (write path) and the
 * milestone-type registry so a stored milestone `type` and a registered
 * `milestone_types.key` live in the SAME canonical key space — recognition is a
 * plain string equality at read time.
 *
 * TOLERANCE: a well-formed but UNRECOGNIZED milestone type is always accepted and
 * stored. Tolerance is about recognition, not data hygiene — a MALFORMED type
 * (wrong shape, too long) is still rejected so the key space stays clean.
 */

/** Inclusive character bounds for a freeform log line. */
const LOG_TEXT_MIN = 1;
export const LOG_TEXT_MAX = 2000;

/** Inclusive upper bound for a milestone type key. */
export const MILESTONE_TYPE_MAX = 80;

/** Max serialized byte length of a milestone `metadata` object. */
export const METADATA_MAX_BYTES = 4096;

/** Max nesting depth allowed inside a milestone `metadata` object. */
export const METADATA_MAX_DEPTH = 5;

/**
 * Canonical milestone-type key: lowercase slug, starts alphanumeric, then
 * alphanumerics or hyphens, 1–80 chars. e.g. `first-jump`, `credits-10m`.
 */
const MILESTONE_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** Trim and lowercase a raw milestone type into its canonical key form. */
export function normalizeMilestoneType(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True when `key` (already normalized) is a valid canonical milestone key. */
export function isValidMilestoneType(key: string): boolean {
  return MILESTONE_TYPE_PATTERN.test(key);
}

/** Outcome of {@link validateLogText}. */
export type LogTextResult =
  | { ok: true; value: string }
  | { ok: false; reason: "invalid_text" };

/**
 * Validate a freeform log line. Trims surrounding whitespace, then enforces the
 * length bounds. Empty-after-trim is rejected.
 */
export function validateLogText(raw: unknown): LogTextResult {
  if (typeof raw !== "string") return { ok: false, reason: "invalid_text" };
  const text = raw.trim();
  if (text.length < LOG_TEXT_MIN || text.length > LOG_TEXT_MAX) {
    return { ok: false, reason: "invalid_text" };
  }
  return { ok: true, value: text };
}

/** Outcome of {@link validateMilestoneType}. */
export type MilestoneTypeResult =
  | { ok: true; value: string }
  | { ok: false; reason: "invalid_type" };

/**
 * Normalize and validate a milestone type. Accepts any well-formed key — known
 * or unknown — and rejects only malformed shapes (so ingestion stays tolerant of
 * unrecognized milestones while keeping the key space clean).
 */
export function validateMilestoneType(raw: unknown): MilestoneTypeResult {
  if (typeof raw !== "string") return { ok: false, reason: "invalid_type" };
  const key = normalizeMilestoneType(raw);
  if (!isValidMilestoneType(key)) return { ok: false, reason: "invalid_type" };
  return { ok: true, value: key };
}

/** Outcome of {@link validateMetadata}. */
export type MetadataResult =
  | { ok: true; value: null | string }
  | { ok: false; reason: "invalid_metadata" };

/** Recursively measure the maximum nesting depth of a JSON-ish value. */
function jsonDepth(value: unknown): number {
  if (Array.isArray(value)) {
    let max = 0;
    for (const item of value) max = Math.max(max, jsonDepth(item));
    return max + 1;
  }
  if (value !== null && typeof value === "object") {
    let max = 0;
    for (const item of Object.values(value)) max = Math.max(max, jsonDepth(item));
    return max + 1;
  }
  return 0;
}

/**
 * Validate optional milestone `metadata`. Accepts `undefined`/`null` (stored as
 * NULL) or a PLAIN JSON OBJECT (not an array, not a primitive). Caps the
 * serialized byte length and nesting depth, then returns the canonical
 * `JSON.stringify` form for storage.
 */
export function validateMetadata(raw?: unknown): MetadataResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "invalid_metadata" };
  }
  if (jsonDepth(raw) > METADATA_MAX_DEPTH) {
    return { ok: false, reason: "invalid_metadata" };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { ok: false, reason: "invalid_metadata" };
  }
  // JSON.stringify drops `undefined`/functions; a value like `{a: undefined}`
  // serializes to `{}`. That is acceptable — the stored shape is well-formed.
  if (new TextEncoder().encode(serialized).length > METADATA_MAX_BYTES) {
    return { ok: false, reason: "invalid_metadata" };
  }
  return { ok: true, value: serialized };
}
