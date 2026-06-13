import type { PageServerLoad } from "./$types";

import { listClosedSeasonPodiums } from "../../lib/db/seasons";
import { groupSeasonPodiums } from "../../lib/seasons/recognition";

/**
 * Hall of Fame (`/hall-of-fame`) — every CLOSED Universe season's champion and
 * podium, newest first.
 *
 * Recognition is DERIVED from the immutable season archive (`season_standings`,
 * DEC-I2): champion = final rank 1, podium = ranks 1..3. `listClosedSeasonPodiums`
 * only reads seasons whose `closed_at` is set, so an in-progress season never
 * appears — recognition is immutable once a season closes. Universe standings are
 * public (the leaderboard is public), so no visibility filtering applies here.
 */
export const load: PageServerLoad = async ({ platform }) => {
  const db = platform?.env.DB;
  if (!db) return { seasons: [] };

  const rows = await listClosedSeasonPodiums(db);
  return { seasons: groupSeasonPodiums(rows) };
};
