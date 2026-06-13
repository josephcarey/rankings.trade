import { describe, expect, it } from "vitest";

import { unrankedUntilFor } from "./close";

/**
 * Dedicated boundary cases for the UTC date arithmetic in {@link unrankedUntilFor} (audit §7.2),
 * which was previously only exercised indirectly via the seasons pipeline.
 */
describe("unrankedUntilFor — boundary cases (§7.2)", () => {
  it("returns null when the gap is 0 (no unranked window)", () => {
    expect(unrankedUntilFor("2026-06-01", 0)).toBeNull();
  });

  it("returns null for a negative gap", () => {
    expect(unrankedUntilFor("2026-06-01", -3)).toBeNull();
  });

  it("adds the gap within a single month", () => {
    expect(unrankedUntilFor("2026-06-01", 7)).toBe("2026-06-08");
  });

  it("wraps across the year boundary (Dec 31 -> Jan 1)", () => {
    expect(unrankedUntilFor("2026-12-31", 1)).toBe("2027-01-01");
    expect(unrankedUntilFor("2026-12-28", 5)).toBe("2027-01-02");
  });

  it("crosses the leap day in a leap year (2028: Feb 28 -> Feb 29 -> Mar 1)", () => {
    expect(unrankedUntilFor("2028-02-28", 1)).toBe("2028-02-29");
    expect(unrankedUntilFor("2028-02-28", 2)).toBe("2028-03-01");
  });

  it("skips Feb 29 in a non-leap year (2027: Feb 28 -> Mar 1)", () => {
    expect(unrankedUntilFor("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("operates on the date portion only, ignoring any time component", () => {
    expect(unrankedUntilFor("2026-12-31T23:59:59Z", 1)).toBe("2027-01-01");
  });
});
