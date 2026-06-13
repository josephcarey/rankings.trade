import { describe, expect, it } from "vitest";

import { TITLE_LADDER, titleBadge } from "./badge";

describe("titleBadge", () => {
  it("returns the neutral Unranked badge for null/undefined/blank", () => {
    for (const input of [null, undefined, "", " ".repeat(3)]) {
      const badge = titleBadge(input);
      expect(badge.known).toBe(false);
      expect(badge.label).toBe("Unranked");
      expect(badge.slug).toBe("unranked");
      expect(badge.rank).toBe(0);
    }
  });

  it("maps the bottom tier Cadet to ladder position 1", () => {
    const badge = titleBadge("Cadet");
    expect(badge).toEqual({
      known: true,
      label: "Cadet",
      rank: 1,
      slug: "cadet",
    });
  });

  it("maps the top tier Fleet Admiral to the highest position with a kebab slug", () => {
    const badge = titleBadge("Fleet Admiral");
    expect(badge.known).toBe(true);
    expect(badge.slug).toBe("fleet-admiral");
    expect(badge.rank).toBe(TITLE_LADDER.length);
  });

  it("orders the ladder lowest → highest", () => {
    expect(TITLE_LADDER[0]).toBe("Cadet");
    expect(TITLE_LADDER.at(-1)).toBe("Fleet Admiral");
    expect(TITLE_LADDER).toContain("Commodore");
  });

  it("assigns a strictly increasing rank up the ladder", () => {
    const ranks = TITLE_LADDER.map((t) => titleBadge(t).rank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]!).toBe(ranks[i - 1]! + 1);
    }
  });

  it("degrades an unknown title to its own label with neutral styling", () => {
    const badge = titleBadge("Grand Poobah");
    expect(badge.known).toBe(false);
    expect(badge.label).toBe("Grand Poobah");
    expect(badge.slug).toBe("unranked");
    expect(badge.rank).toBe(0);
  });
});
