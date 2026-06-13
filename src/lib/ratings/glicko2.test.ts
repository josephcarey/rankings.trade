import { describe, expect, it } from "vitest";

import type { Glicko2Config, RatingState } from "./config";

import { GLICKO2_CONFIG } from "./config";
import { glicko2Update, inflateIdleRd, type Outcome } from "./glicko2";

/**
 * The published worked example uses τ = 0.5 and does NOT clamp RD, so the reference
 * tests run with τ = 0.5 and an RD band wide enough to never bite (the expected RD'
 * 151.52 sits well inside it). Production keeps τ = 0.6 and the real band.
 */
const PAPER_CONFIG: Glicko2Config = {
  ...GLICKO2_CONFIG,
  initialRd: 1000,
  rdFloor: 1,
  tau: 0.5,
};

describe("glicko2Update — Glickman reference vectors", () => {
  // Player: r=1500, RD=200, σ=0.06 vs three opponents (paper §"Step-by-step").
  const player: RatingState = { rating: 1500, rd: 200, volatility: 0.06 };
  const outcomes: Outcome[] = [
    { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
    { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
    { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
  ];

  const result = glicko2Update(player, outcomes, PAPER_CONFIG);

  it("produces the reference rating r' ≈ 1464.06", () => {
    expect(result.rating).toBeCloseTo(1464.06, 1);
  });

  it("produces the reference deviation RD' ≈ 151.52", () => {
    expect(result.rd).toBeCloseTo(151.52, 1);
  });

  it("produces the reference volatility σ' ≈ 0.05999", () => {
    expect(result.volatility).toBeCloseTo(0.05999, 4);
  });
});

describe("glicko2Update — no games (RD inflation)", () => {
  it("leaves rating and volatility unchanged and inflates RD by φ* = sqrt(φ²+σ²)", () => {
    const state: RatingState = { rating: 1500, rd: 200, volatility: 0.06 };
    const result = glicko2Update(state, [], PAPER_CONFIG);

    expect(result.rating).toBe(1500);
    expect(result.volatility).toBe(0.06);
    // φ = 200/scale; φ* = sqrt(φ²+σ²); RD' = φ*·scale.
    const scale = PAPER_CONFIG.scale;
    const phi = 200 / scale;
    const expected = Math.hypot(phi, 0.06) * scale;
    expect(result.rd).toBeCloseTo(expected, 6);
    expect(result.rd).toBeGreaterThan(200);
  });

  it("inflateIdleRd matches an empty-outcome update", () => {
    const state: RatingState = { rating: 1480, rd: 90, volatility: 0.055 };
    expect(inflateIdleRd(state, PAPER_CONFIG)).toEqual(
      glicko2Update(state, [], PAPER_CONFIG),
    );
  });
});

describe("glicko2Update — outcome semantics", () => {
  it("a draw (0.5) lands between a win and a loss against the same opponent", () => {
    const player: RatingState = { rating: 1500, rd: 200, volatility: 0.06 };
    const opponent: RatingState = { rating: 1500, rd: 200, volatility: 0.06 };

    const win = glicko2Update(player, [{ opponent, score: 1 }], PAPER_CONFIG);
    const draw = glicko2Update(player, [{ opponent, score: 0.5 }], PAPER_CONFIG);
    const loss = glicko2Update(player, [{ opponent, score: 0 }], PAPER_CONFIG);

    expect(win.rating).toBeGreaterThan(draw.rating);
    expect(draw.rating).toBeGreaterThan(loss.rating);
    // A draw against an equal opponent barely moves the rating.
    expect(draw.rating).toBeCloseTo(1500, 5);
  });

  it("beating a strong opponent raises the rating more than beating a weak one", () => {
    const player: RatingState = { rating: 1500, rd: 200, volatility: 0.06 };
    const strong: RatingState = { rating: 1800, rd: 50, volatility: 0.06 };
    const weak: RatingState = { rating: 1200, rd: 50, volatility: 0.06 };

    const beatStrong = glicko2Update(player, [{ opponent: strong, score: 1 }], PAPER_CONFIG);
    const beatWeak = glicko2Update(player, [{ opponent: weak, score: 1 }], PAPER_CONFIG);

    expect(beatStrong.rating).toBeGreaterThan(beatWeak.rating);
  });
});

describe("glicko2Update — RD clamping (production config)", () => {
  it("floors RD so an established rating never freezes", () => {
    // Many decisive games drive RD low; the floor stops it at config.rdFloor.
    const player: RatingState = { rating: 1500, rd: 60, volatility: 0.06 };
    const outcomes: Outcome[] = Array.from({ length: 40 }, (_, i) => ({
      opponent: { rating: 1400 + i, rd: 40, volatility: 0.06 },
      score: 1,
    }));
    const result = glicko2Update(player, outcomes, GLICKO2_CONFIG);
    expect(result.rd).toBeGreaterThanOrEqual(GLICKO2_CONFIG.rdFloor);
  });

  it("caps inflated RD at the baseline initialRd", () => {
    const state: RatingState = { rating: 1500, rd: 349, volatility: 0.2 };
    const result = inflateIdleRd(state, GLICKO2_CONFIG);
    expect(result.rd).toBeLessThanOrEqual(GLICKO2_CONFIG.initialRd);
    expect(result.rd).toBe(GLICKO2_CONFIG.initialRd);
  });
});
