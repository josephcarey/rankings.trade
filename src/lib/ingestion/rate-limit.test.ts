import { describe, expect, it } from "vitest";

import {
  DEFAULT_RATE_LIMIT_CONFIG,
  isWithinLimit,
  retryAfterSeconds,
  windowIndex,
} from "./rate-limit";

describe("windowIndex", () => {
  it("groups times within the same window to one index", () => {
    expect(windowIndex(0, 60_000)).toBe(0);
    expect(windowIndex(59_999, 60_000)).toBe(0);
    expect(windowIndex(60_000, 60_000)).toBe(1);
    expect(windowIndex(125_000, 60_000)).toBe(2);
  });
});

describe("retryAfterSeconds", () => {
  it("reports seconds until the window rolls over", () => {
    // 10s into a 60s window → 50s remain.
    expect(retryAfterSeconds(10_000, 60_000)).toBe(50);
  });

  it("is at least 1 at a window boundary", () => {
    expect(retryAfterSeconds(60_000, 60_000)).toBe(60);
    expect(retryAfterSeconds(59_500, 60_000)).toBe(1);
  });
});

describe("isWithinLimit", () => {
  it("allows counts up to and including the limit", () => {
    expect(isWithinLimit(1, 60)).toBe(true);
    expect(isWithinLimit(60, 60)).toBe(true);
    expect(isWithinLimit(61, 60)).toBe(false);
  });
});

describe("DEFAULT_RATE_LIMIT_CONFIG", () => {
  it("is 60 requests per 60s window", () => {
    expect(DEFAULT_RATE_LIMIT_CONFIG).toEqual({ windowMs: 60_000, limit: 60 });
  });
});
