import { describe, expect, it } from "vitest";

import type { RatingState } from "./config";

import { baselineState, GLICKO2_CONFIG } from "./config";
import { glicko2Update } from "./glicko2";
import {
  computeRatingPeriod,
  type PeriodParticipant,
} from "./rating-period";

function baseline(): RatingState {
  return baselineState();
}

function participant(
  agentId: number,
  finalCredits: number,
  state: RatingState = baseline(),
): PeriodParticipant {
  return { agentId, finalCredits, state };
}

describe("computeRatingPeriod — pairwise expansion", () => {
  it("updates each participant exactly once", () => {
    const results = computeRatingPeriod(
      [participant(1, 300), participant(2, 200), participant(3, 100)],
      [],
    );
    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.agentId))).toEqual(new Set([1, 2, 3]));
  });

  it("ranks new ratings by final credits (winner highest, loser lowest)", () => {
    const results = computeRatingPeriod(
      [participant(1, 300), participant(2, 200), participant(3, 100)],
      [],
    );
    const byId = new Map(results.map((r) => [r.agentId, r.state.rating]));
    expect(byId.get(1)!).toBeGreaterThan(byId.get(2)!);
    expect(byId.get(2)!).toBeGreaterThan(byId.get(3)!);
  });

  it("matches a hand-rolled round-robin update for the top agent", () => {
    const p1 = participant(1, 300);
    const p2 = participant(2, 200);
    const p3 = participant(3, 100);
    const results = computeRatingPeriod([p1, p2, p3], []);

    // Agent 1 beat 2 and 3 → two wins against their pre-period states.
    const expected = glicko2Update(p1.state, [
      { opponent: p2.state, score: 1 },
      { opponent: p3.state, score: 1 },
    ]);
    const got = results.find((r) => r.agentId === 1)!.state;
    expect(got.rating).toBeCloseTo(expected.rating, 6);
    expect(got.rd).toBeCloseTo(expected.rd, 6);
    expect(got.volatility).toBeCloseTo(expected.volatility, 6);
  });

  it("treats equal final credits as a draw for both agents", () => {
    const results = computeRatingPeriod(
      [participant(1, 200), participant(2, 200)],
      [],
    );
    const r1 = results.find((r) => r.agentId === 1)!.state.rating;
    const r2 = results.find((r) => r.agentId === 2)!.state.rating;
    // Equal-credit draw between two equal baseline agents ⇒ both stay at baseline.
    expect(r1).toBeCloseTo(GLICKO2_CONFIG.initialRating, 5);
    expect(r2).toBeCloseTo(GLICKO2_CONFIG.initialRating, 5);
    expect(r1).toBeCloseTo(r2, 9);
  });

  it("partial ties: a three-way split with one clear winner", () => {
    // Two agents tie for first (300), one trails (100).
    const results = computeRatingPeriod(
      [participant(1, 300), participant(2, 300), participant(3, 100)],
      [],
    );
    const byId = new Map(results.map((r) => [r.agentId, r.state.rating]));
    expect(byId.get(1)!).toBeCloseTo(byId.get(2)!, 6); // tied agents move identically
    expect(byId.get(1)!).toBeGreaterThan(byId.get(3)!);
  });

  it("uses PRE-period opponent states (order-independent / simultaneous)", () => {
    const a = participant(1, 300, { rating: 1600, rd: 200, volatility: 0.06 });
    const b = participant(2, 100, { rating: 1400, rd: 200, volatility: 0.06 });

    const forward = computeRatingPeriod([a, b], []);
    const reversed = computeRatingPeriod([b, a], []);

    const fa = forward.find((r) => r.agentId === 1)!.state.rating;
    const ra = reversed.find((r) => r.agentId === 1)!.state.rating;
    expect(fa).toBeCloseTo(ra, 9);
  });

  it("a lone participant has no opponents → RD inflation only", () => {
    const state: RatingState = { rating: 1530, rd: 120, volatility: 0.06 };
    const results = computeRatingPeriod([participant(7, 500, state)], []);
    const got = results.find((r) => r.agentId === 7)!.state;
    expect(got.rating).toBe(1530);
    expect(got.rd).toBeGreaterThan(120);
  });
});

describe("computeRatingPeriod — non-participant RD inflation", () => {
  it("inflates idle agents' RD and leaves rating/volatility unchanged", () => {
    const idleState: RatingState = { rating: 1480, rd: 90, volatility: 0.055 };
    const results = computeRatingPeriod(
      [participant(1, 300), participant(2, 100)],
      [{ agentId: 9, state: idleState }],
    );
    const idle = results.find((r) => r.agentId === 9)!.state;
    expect(idle.rating).toBe(1480);
    expect(idle.volatility).toBe(0.055);
    expect(idle.rd).toBeGreaterThan(90);
    expect(idle.rd).toBe(glicko2Update(idleState, []).rd);
  });

  it("returns participants and idle agents together", () => {
    const results = computeRatingPeriod(
      [participant(1, 300), participant(2, 100)],
      [{ agentId: 9, state: baseline() }, { agentId: 10, state: baseline() }],
    );
    expect(results).toHaveLength(4);
    expect(new Set(results.map((r) => r.agentId))).toEqual(new Set([1, 2, 9, 10]));
  });

  it("an empty round still inflates all existing rated agents", () => {
    const results = computeRatingPeriod(
      [],
      [
        { agentId: 9, state: { rating: 1500, rd: 100, volatility: 0.06 } },
        { agentId: 10, state: { rating: 1700, rd: 80, volatility: 0.06 } },
      ],
    );
    expect(results).toHaveLength(2);
    for (const r of results) expect(r.state.rd).toBeGreaterThan(0);
  });

  it("mixes first-time (baseline) and established participants", () => {
    const newcomer = participant(1, 500, baseline());
    const veteran = participant(2, 100, { rating: 1800, rd: 60, volatility: 0.05 });
    const results = computeRatingPeriod([newcomer, veteran], []);
    const n = results.find((r) => r.agentId === 1)!.state;
    const v = results.find((r) => r.agentId === 2)!.state;
    // Newcomer beat a strong veteran → rating climbs above baseline.
    expect(n.rating).toBeGreaterThan(GLICKO2_CONFIG.initialRating);
    // Veteran lost to a newcomer → rating drops.
    expect(v.rating).toBeLessThan(1800);
  });
});
