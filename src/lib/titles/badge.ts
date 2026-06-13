/**
 * Title → badge presentation metadata (Epic J).
 *
 * Pure derivation, no DB. The ladder is the SINGLE SOURCE OF TRUTH from
 * {@link TITLE_CONFIG} (Epic I), read lowest → highest so a badge carries its
 * position on the Cadet → Fleet Admiral ladder. The UI styles each tier by its
 * stable {@link TitleBadge.slug} (a kebab-cased tier name), so re-tuning the
 * ladder config never desyncs the styling.
 *
 * An agent with no title (not "established" this season, or no open season at
 * all — DEC-I2) is rendered as the neutral, off-ladder "Unranked" badge rather
 * than a fabricated tier.
 */

import { TITLE_CONFIG } from "./config";

/** Presentation metadata for one title badge. */
export interface TitleBadge {
  /** Whether this maps to a known ladder tier (false for Unranked/unknown). */
  readonly known: boolean;
  /** Human label shown in the badge. */
  readonly label: string;
  /** 1-based ladder position (Cadet = 1 … Fleet Admiral = N); 0 when off-ladder. */
  readonly rank: number;
  /** Stable kebab-cased style key, e.g. `fleet-admiral`, or `unranked`. */
  readonly slug: string;
}

/** Kebab-case a tier name for use as a stable CSS/style key. */
function slugify(name: string): string {
  return name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}

/**
 * The ladder names ordered LOWEST → HIGHEST, derived from {@link TITLE_CONFIG}
 * (which is stored highest → lowest). Recalibrating the config recalibrates this.
 */
export const TITLE_LADDER: readonly string[] = TITLE_CONFIG.tiers
  .map((tier) => tier.name)
  .toReversed();

/** The neutral, off-ladder badge for an agent with no current title. */
const UNRANKED: TitleBadge = {
  known: false,
  label: "Unranked",
  rank: 0,
  slug: "unranked",
};

/**
 * Resolve the badge metadata for a title.
 *
 * @param title - A ladder title, or null/empty for no title (Unranked).
 * @returns The badge metadata. A non-null title that is not on the ladder is
 *   shown with its own label but neutral (off-ladder) styling, so unexpected
 *   data degrades gracefully instead of throwing.
 */
export function titleBadge(title: null | string | undefined): TitleBadge {
  if (title === null || title === undefined || title.trim().length === 0) {
    return UNRANKED;
  }

  const index = TITLE_LADDER.indexOf(title);
  if (index === -1) {
    return { known: false, label: title, rank: 0, slug: "unranked" };
  }

  return { known: true, label: title, rank: index + 1, slug: slugify(title) };
}
