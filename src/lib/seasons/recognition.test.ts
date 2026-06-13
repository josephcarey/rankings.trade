import { describe, expect, it } from "vitest";

import type { PodiumStandingInput } from "./recognition";

import {
  groupSeasonPodiums,
  isPodiumRank,
  PODIUM_SIZE,
  seasonBadge,
  selectChampions,
  selectPodium,
} from "./recognition";

/** Build a flat podium row with sensible defaults. */
function row(
  over: Partial<PodiumStandingInput> & { final_rank: number },
): PodiumStandingInput {
  return {
    agent_id: over.agent_id ?? over.final_rank,
    final_rating: over.final_rating ?? 1500 - over.final_rank * 10,
    final_rank: over.final_rank,
    label: over.label ?? "Season 1",
    season_id: over.season_id ?? 1,
    symbol: over.symbol ?? `A${over.final_rank}`,
    title: over.title ?? null,
  };
}

describe("isPodiumRank", () => {
  it("accepts integer ranks 1..PODIUM_SIZE only", () => {
    expect(isPodiumRank(1)).toBe(true);
    expect(isPodiumRank(PODIUM_SIZE)).toBe(true);
    expect(isPodiumRank(PODIUM_SIZE + 1)).toBe(false);
    expect(isPodiumRank(0)).toBe(false);
    expect(isPodiumRank(-1)).toBe(false);
    expect(isPodiumRank(2.5)).toBe(false);
  });
});

describe("selectPodium / selectChampions", () => {
  it("keeps only ranks 1..3 for the podium", () => {
    const standings = [1, 2, 3, 4, 5].map((r) => ({ final_rank: r }));
    expect(selectPodium(standings).map((s) => s.final_rank)).toEqual([1, 2, 3]);
  });

  it("returns a single champion when rank 1 is uncontested", () => {
    const standings = [1, 2, 3].map((r) => ({ final_rank: r }));
    expect(selectChampions(standings)).toEqual([{ final_rank: 1 }]);
  });

  it("returns multiple champions on a tie at rank 1 (ranks 1,1,3)", () => {
    // Competition ranking: a 2-way tie at the top is 1, 1, 3 — no runner-up.
    const standings = [{ final_rank: 1 }, { final_rank: 1 }, { final_rank: 3 }];
    expect(selectChampions(standings)).toHaveLength(2);
    expect(selectPodium(standings).map((s) => s.final_rank)).toEqual([1, 1, 3]);
  });

  it("handles a season with fewer than three agents", () => {
    const standings = [{ final_rank: 1 }, { final_rank: 2 }];
    expect(selectPodium(standings)).toHaveLength(2);
    expect(selectChampions(standings)).toHaveLength(1);
  });
});

describe("seasonBadge", () => {
  it("awards champion/runner-up/third for closed-season podium ranks", () => {
    expect(seasonBadge(1, true)).toEqual({
      label: "Season Champion",
      placement: 1,
      slug: "champion",
    });
    expect(seasonBadge(2, true)?.slug).toBe("runner-up");
    expect(seasonBadge(3, true)?.slug).toBe("third");
  });

  it("awards NO badge for an open (not-yet-closed) season — immutability", () => {
    expect(seasonBadge(1, false)).toBeNull();
    expect(seasonBadge(2, false)).toBeNull();
  });

  it("awards no badge below the podium", () => {
    expect(seasonBadge(4, true)).toBeNull();
    expect(seasonBadge(0, true)).toBeNull();
  });
});

describe("groupSeasonPodiums", () => {
  it("returns an empty list for no rows", () => {
    expect(groupSeasonPodiums([])).toEqual([]);
  });

  it("groups rows per season preserving season and rank order", () => {
    const rows: PodiumStandingInput[] = [
      row({ final_rank: 1, season_id: 2, symbol: "WIN2" }),
      row({ final_rank: 2, season_id: 2, symbol: "RUN2" }),
      row({ final_rank: 3, season_id: 2, symbol: "THR2" }),
      row({ final_rank: 1, season_id: 1, symbol: "WIN1" }),
    ];
    const grouped = groupSeasonPodiums(rows);
    expect(grouped.map((g) => g.seasonId)).toEqual([2, 1]);
    expect(grouped[0]!.podium.map((p) => p.symbol)).toEqual([
      "WIN2",
      "RUN2",
      "THR2",
    ]);
    expect(grouped[0]!.champions.map((c) => c.symbol)).toEqual(["WIN2"]);
    expect(grouped[1]!.podium).toHaveLength(1);
  });

  it("surfaces co-champions on a tie at rank 1", () => {
    const rows: PodiumStandingInput[] = [
      row({ agent_id: 10, final_rank: 1, symbol: "CO1" }),
      row({ agent_id: 11, final_rank: 1, symbol: "CO2" }),
      row({ agent_id: 12, final_rank: 3, symbol: "BRZ" }),
    ];
    const [entry] = groupSeasonPodiums(rows);
    expect(entry!.champions.map((c) => c.symbol)).toEqual(["CO1", "CO2"]);
    expect(entry!.podium).toHaveLength(3);
  });

  it("carries through rating and title onto entries", () => {
    const rows: PodiumStandingInput[] = [
      row({ final_rank: 1, final_rating: 1800, symbol: "ACE", title: "Admiral" }),
    ];
    const [entry] = groupSeasonPodiums(rows);
    expect(entry!.podium[0]).toEqual({
      agentId: 1,
      rank: 1,
      rating: 1800,
      symbol: "ACE",
      title: "Admiral",
    });
  });
});
