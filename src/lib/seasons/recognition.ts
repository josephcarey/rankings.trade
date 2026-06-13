/**
 * End-of-season recognition derivation (Epic N) — pure, no DB.
 *
 * Champion and podium are DERIVED ON READ from the immutable season archive
 * (`season_standings`, written once at close — DEC-I2). We never add a
 * denormalized champion flag; the archived `final_rank` is the single source of
 * truth. `final_rank` is a competition ranking (ties share a rank), so a 2-way
 * tie at the top yields ranks `1, 1, 3`: both agents are champions and there is
 * no runner-up.
 *
 * IMMUTABILITY: recognition exists ONLY for a CLOSED season. The open season has
 * no archived standings, and {@link seasonBadge} additionally refuses to mint a
 * badge unless the caller asserts the season is closed — a redundant but
 * defensive guard so an in-progress placement is never shown as an award.
 */

/** Number of top finishers recognised on the podium (champion + runner-up + third). */
export const PODIUM_SIZE = 3;

/** The minimal archived-standing shape recognition is derived from. */
export interface RankedStanding {
  readonly final_rank: number;
}

/** A flat podium row (one closed-season top-3 placement) as read from the archive. */
export interface PodiumStandingInput {
  readonly season_id: number;
  readonly label: string;
  readonly agent_id: number;
  readonly symbol: string;
  readonly final_rank: number;
  readonly final_rating: number;
  readonly title: null | string;
}

/** One agent's podium placement, render-ready. */
interface PodiumEntry {
  readonly agentId: number;
  readonly symbol: string;
  readonly rank: number;
  readonly rating: number;
  readonly title: null | string;
}

/** One closed season's recognition: its champion(s) and full podium. */
export interface SeasonHallEntry {
  readonly seasonId: number;
  readonly label: string;
  /** Every agent sharing the top rank (rank 1); more than one on a tie. */
  readonly champions: PodiumEntry[];
  /** Ranks 1..{@link PODIUM_SIZE}, ordered best first. */
  readonly podium: PodiumEntry[];
}

/** Presentation metadata for a podium recognition badge. */
export interface SeasonBadgeMeta {
  /** The placement (final rank): 1, 2 or 3. */
  readonly placement: number;
  /** Human label shown in the badge. */
  readonly label: string;
  /** Stable kebab-cased style key. */
  readonly slug: string;
}

/** True when `rank` is a podium placement (an integer in 1..{@link PODIUM_SIZE}). */
export function isPodiumRank(rank: number): boolean {
  return Number.isInteger(rank) && rank >= 1 && rank <= PODIUM_SIZE;
}

/** The podium subset (ranks 1..{@link PODIUM_SIZE}) of a season's standings. */
export function selectPodium<T extends RankedStanding>(
  standings: readonly T[],
): T[] {
  return standings.filter((s) => isPodiumRank(s.final_rank));
}

/** The champion(s): every agent sharing rank 1. Empty when there are none. */
export function selectChampions<T extends RankedStanding>(
  standings: readonly T[],
): T[] {
  return standings.filter((s) => s.final_rank === 1);
}

const PLACEMENT_META: Record<1 | 2 | 3, { label: string; slug: string }> = {
  1: { label: "Season Champion", slug: "champion" },
  2: { label: "Runner-up", slug: "runner-up" },
  3: { label: "Third place", slug: "third" },
};

/**
 * The recognition badge for a final placement in a CLOSED season, or `null` when
 * there is nothing to award.
 *
 * @param rank - The archived `final_rank`.
 * @param closed - Whether the season is closed. Recognition is immutable and only
 *   exists once a season is closed, so an open season (false) never earns a badge.
 * @returns Badge metadata for a closed-season podium finish, else `null`.
 */
export function seasonBadge(
  rank: number,
  closed: boolean,
): null | SeasonBadgeMeta {
  if (!closed || !isPodiumRank(rank)) return null;
  const meta = PLACEMENT_META[rank as 1 | 2 | 3];
  return { label: meta.label, placement: rank, slug: meta.slug };
}

/** Shape one archived podium row into a render-ready {@link PodiumEntry}. */
function toPodiumEntry(row: PodiumStandingInput): PodiumEntry {
  return {
    agentId: row.agent_id,
    rank: row.final_rank,
    rating: row.final_rating,
    symbol: row.symbol,
    title: row.title,
  };
}

/**
 * Group flat closed-season podium rows into per-season hall-of-fame entries.
 *
 * Input rows MUST already be ordered season-newest-first then rank-ascending (the
 * order {@link listClosedSeasonPodiums} returns); grouping preserves that order so
 * each season's podium reads best-first and the seasons read newest-first. Only
 * podium ranks are kept ({@link selectPodium}), and champions are the rank-1
 * entries ({@link selectChampions}), so a tie at the top yields multiple champions.
 */
export function groupSeasonPodiums(
  rows: readonly PodiumStandingInput[],
): SeasonHallEntry[] {
  const bySeason = new Map<number, { label: string; rows: PodiumStandingInput[] }>();
  const order: number[] = [];
  for (const row of rows) {
    let group = bySeason.get(row.season_id);
    if (!group) {
      group = { label: row.label, rows: [] };
      bySeason.set(row.season_id, group);
      order.push(row.season_id);
    }
    group.rows.push(row);
  }

  return order.map((seasonId) => {
    const group = bySeason.get(seasonId) as {
      label: string;
      rows: PodiumStandingInput[];
    };
    const podium = selectPodium(group.rows).map((r) => toPodiumEntry(r));
    const champions = selectChampions(group.rows).map((r) => toPodiumEntry(r));
    return { champions, label: group.label, podium, seasonId };
  });
}
