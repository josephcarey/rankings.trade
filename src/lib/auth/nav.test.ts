import { describe, expect, it } from "vitest";

import { toNavState } from "./nav";

describe("toNavState", () => {
  it("reports signed in when a Clerk userId is present", () => {
    expect(toNavState({ userId: "user_123" })).toEqual({
      signedIn: true,
      userId: "user_123",
    });
  });

  it("reports signed out when there is no userId", () => {
    expect(toNavState({ userId: null })).toEqual({
      signedIn: false,
      userId: null,
    });
  });
});
