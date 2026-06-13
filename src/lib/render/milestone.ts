/**
 * Milestone display normalization (Epic J) — pure, no DB.
 *
 * Milestones are TOLERANT (any well-formed type is stored) and recognition is
 * computed at READ time against a context-specific set of recognized type keys
 * (global defaults plus the relevant, viewer-visible league's custom types — see
 * `src/lib/db/milestone-types.ts`). This module turns one stored milestone plus
 * that recognized-key map into a safe, render-ready view model.
 *
 * Safety: every field is returned as a plain string and rendered through
 * Svelte's default text escaping (never `{@html}`), so attacker-controlled
 * milestone metadata cannot inject markup.
 */

/** The minimal stored shape this module needs. */
export interface MilestoneLike {
  readonly metadata: null | string;
  readonly ts: string;
  readonly type: string;
}

/** One flattened metadata entry for display. */
export interface MilestoneField {
  readonly key: string;
  readonly value: string;
}

/** A render-ready milestone. */
export interface MilestoneView {
  readonly fields: readonly MilestoneField[];
  readonly label: string;
  readonly recognized: boolean;
  readonly ts: string;
  readonly type: string;
}

/** Title-case a milestone type key, e.g. `first_million` → `First million`. */
export function humanizeType(type: string): string {
  const words = type.trim().replaceAll(/[_-]+/g, " ").trim();
  if (words.length === 0) return type;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Render one metadata value as a single display string. */
function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Flatten a milestone's canonical-JSON metadata into display fields. Returns an
 * empty list for null, malformed, or non-object metadata (arrays included), so a
 * bad payload degrades to "no detail" rather than throwing.
 */
export function parseMetadataFields(
  metadata: null | string,
): MilestoneField[] {
  if (metadata === null || metadata.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  return Object.entries(parsed as Record<string, unknown>).map(([key, v]) => ({
    key,
    value: formatValue(v),
  }));
}

/**
 * Build the render-ready view for a milestone.
 *
 * @param record - The stored milestone (type, metadata, ts).
 * @param recognized - Map of recognized type key → optional custom label, for
 *   the current read context. Presence of the key marks the milestone
 *   recognized; a non-empty mapped label is preferred over the humanized type.
 */
export function describeMilestone(
  record: MilestoneLike,
  recognized: ReadonlyMap<string, null | string>,
): MilestoneView {
  const recognizedLabel = recognized.get(record.type);
  const isRecognized = recognized.has(record.type);
  const label =
    recognizedLabel != null && recognizedLabel.length > 0
      ? recognizedLabel
      : humanizeType(record.type);

  return {
    fields: parseMetadataFields(record.metadata),
    label,
    recognized: isRecognized,
    ts: record.ts,
    type: record.type,
  };
}
