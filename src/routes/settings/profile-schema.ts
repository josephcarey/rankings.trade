import * as v from "valibot";

const MAX_URL_LENGTH = 2048;

/**
 * Whether a string is a well-formed absolute http(s) URL.
 *
 * @param value - The candidate URL.
 * @returns `true` for an absolute `http:`/`https:` URL.
 */
function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * Profile settings form schema: a visibility choice and an optional dashboard
 * link. The dashboard URL is trimmed, length-bounded, and either empty
 * (clearable) or a well-formed http(s) URL.
 */
export const profileSchema = v.object({
  dashboard_url: v.pipe(
    v.string(),
    v.trim(),
    v.maxLength(
      MAX_URL_LENGTH,
      `Dashboard URL must be ${MAX_URL_LENGTH} characters or fewer.`,
    ),
    v.check(
      (value) => value === "" || isHttpUrl(value),
      "Enter a valid http(s) URL.",
    ),
  ),
  visibility: v.picklist(["public", "private"]),
});

/**
 * Maps a validated dashboard URL field to its persisted form: an empty string
 * clears the link (stored as `null`).
 *
 * @param value - The trimmed, validated dashboard URL (possibly empty).
 * @returns The URL, or `null` when cleared.
 */
export function toDashboardUrl(value: string): string | null {
  return value === "" ? null : value;
}
