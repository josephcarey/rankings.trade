import { describe, expect, it } from "vitest";

import { isAdmin } from "./admin";

describe("isAdmin", () => {
  it("returns true for an exact allowlist member", () => {
    expect(isAdmin("user_2abc", { ADMIN_CLERK_USER_IDS: "user_2abc" })).toBe(true);
  });

  it("matches one id among several, trimming whitespace and empty segments", () => {
    const env = { ADMIN_CLERK_USER_IDS: " user_1 , user_2 ,, user_3 " };
    expect(isAdmin("user_2", env)).toBe(true);
    expect(isAdmin("user_3", env)).toBe(true);
  });

  it("fails closed when the allowlist is unset or empty", () => {
    expect(isAdmin("user_1", {})).toBe(false);
    expect(isAdmin("user_1", { ADMIN_CLERK_USER_IDS: "" })).toBe(false);
    expect(isAdmin("user_1", { ADMIN_CLERK_USER_IDS: "  , ,, " })).toBe(false);
  });

  it("returns false for a missing caller id", () => {
    expect(isAdmin(null, { ADMIN_CLERK_USER_IDS: "user_1" })).toBe(false);
    expect(isAdmin(undefined, { ADMIN_CLERK_USER_IDS: "user_1" })).toBe(false);
    expect(isAdmin("", { ADMIN_CLERK_USER_IDS: "user_1" })).toBe(false);
  });

  it("does not match by substring and is case-sensitive", () => {
    const env = { ADMIN_CLERK_USER_IDS: "user_2abc" };
    expect(isAdmin("user_2ab", env)).toBe(false);
    expect(isAdmin("user_2abcd", env)).toBe(false);
    expect(isAdmin("USER_2ABC", env)).toBe(false);
  });
});
