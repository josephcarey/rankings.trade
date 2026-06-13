/**
 * Pure pagination helpers for the public read API (Epic M).
 *
 * Bots pass `limit`/`offset` query params; these are clamped at the boundary so a
 * caller can never request an unbounded page or a negative window. Parsing is
 * tolerant: a missing, empty, non-numeric, or fractional value falls back to the
 * default (limit) or zero (offset) rather than erroring, keeping the read surface
 * forgiving for hand-written tooling.
 */

/** Resolved, clamped pagination window. */
export type Pagination = {
  limit: number;
  offset: number;
};

/** Default page size when `limit` is absent or invalid. */
const DEFAULT_LIMIT = 25;

/** Largest page a caller may request; larger values clamp down to this. */
const MAX_LIMIT = 100;

/** Smallest page size; non-positive requests clamp up to this. */
const MIN_LIMIT = 1;

/** Parse a query value as a non-negative integer, or null if it is not one. */
function parseNonNegativeInt(raw: null | string | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Clamp a raw `limit` into `[MIN_LIMIT, MAX_LIMIT]`, defaulting when absent/invalid.
 */
function clampLimit(raw: null | string | undefined): number {
  const parsed = parseNonNegativeInt(raw);
  if (parsed === null) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}

/** Clamp a raw `offset` to a non-negative integer, defaulting to 0. */
function clampOffset(raw: null | string | undefined): number {
  const parsed = parseNonNegativeInt(raw);
  return parsed ?? 0;
}

/** Resolve both pagination params from raw query strings. */
export function resolvePagination(
  rawLimit: null | string | undefined,
  rawOffset: null | string | undefined,
): Pagination {
  return { limit: clampLimit(rawLimit), offset: clampOffset(rawOffset) };
}
