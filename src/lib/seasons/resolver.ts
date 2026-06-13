/**
 * The production {@link SeasonResolver} (Epic I) — the seam that ACTIVATES ranked rounds.
 *
 * Epic G calls `resolve(db, resetDate)` once per round at finalization to tag it
 * `{ isRanked, seasonId }`. The inert default (src/lib/rounds/seams.ts) always returns
 * `{ false, null }`, so without this resolver NO round is ranked and Epic H's rating trigger
 * never fires in production. This resolver maps a round's reset_date to the open season:
 *
 *   - In a prior season's unranked warm-up gap → `{ isRanked: false, seasonId: null }`.
 *   - Otherwise, if a season is open → `{ isRanked: true, seasonId: open.id }`.
 *   - Otherwise (no open season) → `{ isRanked: false, seasonId: null }`.
 *
 * CONTRACT (enforced by rounds' CHECK and re-checked in finalize.ts): `isRanked: true` always
 * carries a non-null `seasonId`. This holds because ranked is returned only when an open
 * season exists, and its id is non-null.
 */

import type { SeasonResolver } from "../rounds/seams";

import { getOpenSeason, isInUnrankedGap } from "../db/seasons";

/** The locked production season resolver. */
export const seasonResolver: SeasonResolver = {
  async resolve(db: D1Database, resetDate: string) {
    if (await isInUnrankedGap(db, resetDate)) {
      return { isRanked: false, seasonId: null };
    }
    const open = await getOpenSeason(db);
    if (open === null) {
      return { isRanked: false, seasonId: null };
    }
    return { isRanked: true, seasonId: open.id };
  },
};
