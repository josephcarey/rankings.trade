/**
 * Season service (Epic I): the tested logic layer behind the admin season UI/API.
 *
 * Wraps the `seasons` persistence (`db/seasons.ts`) with the admin-facing invariants:
 *   - At most ONE open season at a time. Creating a season while one is open fails with
 *     `open_season_exists` (the DB partial unique index is the backstop; this gives a clean
 *     error instead of a constraint violation).
 *   - Inputs are validated at this boundary: a non-empty label, a `YYYY-MM-DD` cutoff date,
 *     and a non-negative integer unranked-gap length (DEC-3 default 0).
 *   - Only the OPEN season can be reconfigured; a closed season is immutable.
 *
 * Admin authorization is enforced by the caller (API handler / SvelteKit action via
 * `isAdmin`); this layer is auth-agnostic, like the league service.
 */

import type { CreateSeasonFields, Season, SeasonUpdate } from "../db/seasons";

import {
  getOpenSeason,
  getSeasonById,
  insertSeason,
  listSeasons as listSeasonRows,
  updateOpenSeason,
} from "../db/seasons";

/** Discriminated result for season-management operations. */
export type SeasonServiceResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason:
        | "invalid_cutoff"
        | "invalid_gap"
        | "invalid_label"
        | "not_found"
        | "open_season_exists";
    };

/** Raw (untrusted) inputs for creating a season. */
export type CreateSeasonInput = {
  label: string;
  cutoff_date: string;
  unranked_gap_days?: number | undefined;
};

/** Raw (untrusted) inputs for updating the open season. */
export type UpdateSeasonInput = {
  cutoff_date?: string | undefined;
  unranked_gap_days?: number | undefined;
};

const MAX_LABEL_LENGTH = 100;
/** Calendar date, no time component — keeps cutoff comparable to reset_date ordering. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a `YYYY-MM-DD` string that names a real calendar date. */
function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** True for a non-negative integer (gap length in days). */
function isValidGap(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** Validate and normalise the create inputs into persistence fields. */
function normalizeCreate(
  input: CreateSeasonInput,
): SeasonServiceResult<CreateSeasonFields> {
  const label = input.label.trim();
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
    return { ok: false, reason: "invalid_label" };
  }
  if (!isValidDate(input.cutoff_date)) {
    return { ok: false, reason: "invalid_cutoff" };
  }
  const gap = input.unranked_gap_days ?? 0;
  if (!isValidGap(gap)) return { ok: false, reason: "invalid_gap" };

  return {
    ok: true,
    value: { label, cutoff_date: input.cutoff_date, unranked_gap_days: gap },
  };
}

/**
 * Create a new open season. Fails with `open_season_exists` when one is already open, so the
 * "one season at a time" lifecycle is preserved with a clean error.
 */
export async function createSeason(
  db: D1Database,
  input: CreateSeasonInput,
): Promise<SeasonServiceResult<Season>> {
  const normalized = normalizeCreate(input);
  if (!normalized.ok) return normalized;

  if (await getOpenSeason(db)) {
    return { ok: false, reason: "open_season_exists" };
  }

  return { ok: true, value: await insertSeason(db, normalized.value) };
}

/**
 * Reconfigure the open season's cutoff and/or gap. Returns `not_found` when the id is unknown
 * or already closed. Omitted fields are left unchanged.
 */
export async function updateSeason(
  db: D1Database,
  id: number,
  input: UpdateSeasonInput,
): Promise<SeasonServiceResult<Season>> {
  const fields: SeasonUpdate = {};
  if (input.cutoff_date !== undefined) {
    if (!isValidDate(input.cutoff_date)) {
      return { ok: false, reason: "invalid_cutoff" };
    }
    fields.cutoff_date = input.cutoff_date;
  }
  if (input.unranked_gap_days !== undefined) {
    if (!isValidGap(input.unranked_gap_days)) {
      return { ok: false, reason: "invalid_gap" };
    }
    fields.unranked_gap_days = input.unranked_gap_days;
  }

  const existing = await getSeasonById(db, id);
  if (!existing || existing.closed_at !== null) {
    return { ok: false, reason: "not_found" };
  }

  const updated = await updateOpenSeason(db, id, fields);
  if (!updated) return { ok: false, reason: "not_found" };
  return { ok: true, value: updated };
}

/** List every season, newest first. */
export async function listSeasons(db: D1Database): Promise<Season[]> {
  return listSeasonRows(db);
}

/** The current open season, or null when none is open. */
export async function currentSeason(db: D1Database): Promise<Season | null> {
  return getOpenSeason(db);
}
