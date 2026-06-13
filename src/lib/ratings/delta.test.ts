import { describe, expect, it } from "vitest";

import type { DeltaPoint } from "./delta";

import { computeDelta } from "./delta";

describe("computeDelta", () => {
  it("returns null when there is no previous row (new entrant)", () => {
    const missing = ([] as DeltaPoint[]).at(0);
    expect(computeDelta({ rating: 1500, rank: 3 }, null)).toBeNull();
    expect(computeDelta({ rating: 1500, rank: 3 }, missing)).toBeNull();
  });

  it("returns null when there is no latest row", () => {
    expect(computeDelta(null, { rating: 1500, rank: 3 })).toBeNull();
  });

  it("rating delta is latest − previous", () => {
    const delta = computeDelta({ rating: 1540, rank: 2 }, { rating: 1500, rank: 4 });
    expect(delta?.ratingDelta).toBe(40);
  });

  it("rank delta is positive when promoted (moved toward #1)", () => {
    const delta = computeDelta({ rating: 1540, rank: 2 }, { rating: 1500, rank: 5 });
    expect(delta?.rankDelta).toBe(3);
  });

  it("rank delta is negative when demoted", () => {
    const delta = computeDelta({ rating: 1480, rank: 6 }, { rating: 1500, rank: 4 });
    expect(delta?.rankDelta).toBe(-2);
    expect(delta?.ratingDelta).toBe(-20);
  });

  it("is zero on both axes when unchanged", () => {
    const delta = computeDelta({ rating: 1500, rank: 3 }, { rating: 1500, rank: 3 });
    expect(delta).toEqual({ ratingDelta: 0, rankDelta: 0 });
  });
});
