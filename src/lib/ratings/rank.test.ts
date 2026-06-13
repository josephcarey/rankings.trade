import { describe, expect, it } from "vitest";

import { rankByRatingDesc } from "./rank";

describe("rankByRatingDesc", () => {
  it("returns an empty map for no inputs", () => {
    expect(rankByRatingDesc([]).size).toBe(0);
  });

  it("ranks by rating descending, 1-based", () => {
    const ranks = rankByRatingDesc([
      { agentId: 1, rating: 1400 },
      { agentId: 2, rating: 1600 },
      { agentId: 3, rating: 1500 },
    ]);
    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(3)).toBe(2);
    expect(ranks.get(1)).toBe(3);
  });

  it("uses standard competition ranking (1224) so ties share a rank and the next skips", () => {
    const ranks = rankByRatingDesc([
      { agentId: 1, rating: 1600 },
      { agentId: 2, rating: 1500 },
      { agentId: 3, rating: 1500 },
      { agentId: 4, rating: 1400 },
    ]);
    expect(ranks.get(1)).toBe(1);
    expect(ranks.get(2)).toBe(2);
    expect(ranks.get(3)).toBe(2);
    expect(ranks.get(4)).toBe(4);
  });

  it("breaks ties deterministically by agent id without changing the shared rank", () => {
    const ranks = rankByRatingDesc([
      { agentId: 9, rating: 1500 },
      { agentId: 2, rating: 1500 },
    ]);
    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(9)).toBe(1);
  });
});
