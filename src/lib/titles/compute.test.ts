import { describe, expect, it } from "vitest";

import type { TitleInput } from "./compute";
import type { TitleConfig } from "./config";

import { computeTitles, isEstablished } from "./compute";
import { TITLE_CONFIG } from "./config";

/** An established agent at a given rating (RD/rounds clear the floor by default). */
function agent(
  agentId: number,
  rating: number,
  overrides: Partial<TitleInput> = {},
): TitleInput {
  return { agentId, rating, rd: 50, rankedRounds: 5, ...overrides };
}

/** Title for a single agent, given a surrounding population. */
function titleOf(
  population: readonly TitleInput[],
  agentId: number,
  config: TitleConfig = TITLE_CONFIG,
): string | null {
  return computeTitles(population, config).find((r) => r.agentId === agentId)!.title;
}

describe("isEstablished", () => {
  it("requires both the RD cap and the minimum ranked rounds", () => {
    expect(isEstablished(agent(1, 1500, { rd: 100, rankedRounds: 3 }))).toBe(true);
    expect(isEstablished(agent(1, 1500, { rd: 101, rankedRounds: 9 }))).toBe(false);
    expect(isEstablished(agent(1, 1500, { rd: 30, rankedRounds: 2 }))).toBe(false);
  });
});

describe("computeTitles — established floor", () => {
  it("gives an unestablished agent a null title and excludes it from the population", () => {
    // The high-RD agent would otherwise be the top of the field; it must not count.
    const population = [
      agent(1, 3000, { rd: 200, rankedRounds: 1 }), // unestablished
      agent(2, 1500),
    ];
    const results = computeTitles(population);
    expect(results.find((r) => r.agentId === 1)).toMatchObject({
      established: false,
      title: null,
    });
    // Agent 2 is the only established member ⇒ percentile 0, falls to a threshold tier.
    expect(results.find((r) => r.agentId === 2)!.established).toBe(true);
  });
});

describe("computeTitles — threshold tiers", () => {
  it("assigns the highest fixed-threshold tier the rating clears", () => {
    const ratings: Array<[number, string]> = [
      [0, "Cadet"],
      [1349, "Cadet"],
      [1350, "Ensign"],
      [1450, "Lieutenant"],
      [1550, "Commander"],
      [1650, "Captain"],
      [1750, "Commodore"],
    ];
    for (const [rating, expected] of ratings) {
      // Solo field: percentile 0 ⇒ no elite tier, so this isolates the threshold ladder.
      expect(titleOf([agent(1, rating)], 1)).toBe(expected);
    }
  });
});

describe("computeTitles — elite percentile + gate", () => {
  it("awards Fleet Admiral only to a top-2% agent above the gate in a large field", () => {
    // 100 agents: 99 mid-pack at 1800, one leader well above the 2200 gate.
    const population = [
      agent(1, 2500),
      ...Array.from({ length: 99 }, (_, i) => agent(i + 2, 1800)),
    ];
    expect(titleOf(population, 1)).toBe("Fleet Admiral");
  });

  it("keeps the elite slot empty when the field is large but the leader misses the gate", () => {
    // Leader is top of the field (percentile qualifies) but below the 2200 gate.
    const population = [
      agent(1, 2100),
      ...Array.from({ length: 99 }, (_, i) => agent(i + 2, 1500)),
    ];
    // Not Fleet Admiral (gate); 2100 ≥ 2000 + top decile ⇒ Admiral instead.
    expect(titleOf(population, 1)).toBe("Admiral");
  });

  it("keeps elite tiers empty in a tiny field even with a very high rating", () => {
    // N=2: the leader's percentile is 1/2 = 0.5, below every elite band, so it falls to a
    // threshold tier despite a 3000 rating — elites need a larger field.
    const population = [agent(1, 3000), agent(2, 1400)];
    expect(titleOf(population, 1)).toBe("Commodore"); // 3000 ≥ 1750, no elite band reached
  });
});

describe("computeTitles — empty and single-agent fields", () => {
  it("returns no titles for an empty population", () => {
    expect(computeTitles([])).toEqual([]);
  });

  it("never awards an elite tier to a lone agent (percentile 0)", () => {
    expect(titleOf([agent(1, 2600)], 1)).toBe("Commodore");
  });
});

describe("computeTitles — ties", () => {
  it("gives tied ratings the same percentile and tier", () => {
    // Two leaders tie at the top of a 100-strong field; both share the band.
    const population = [
      agent(1, 2400),
      agent(2, 2400),
      ...Array.from({ length: 98 }, (_, i) => agent(i + 3, 1700)),
    ];
    const t1 = titleOf(population, 1);
    const t2 = titleOf(population, 2);
    expect(t1).toBe(t2);
    // strictly-below = 98, N = 100 ⇒ percentile 0.98 ⇒ Fleet Admiral (both, gate cleared).
    expect(t1).toBe("Fleet Admiral");
  });

  it("a fully-tied field shares one percentile (0) and the same threshold tier", () => {
    const population = Array.from({ length: 10 }, (_, i) => agent(i + 1, 1600));
    const results = computeTitles(population);
    expect(results.every((r) => r.title === "Commander")).toBe(true);
  });
});
