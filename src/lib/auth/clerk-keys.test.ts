import { describe, expect, it } from "vitest";

import { getClerkKeys } from "./clerk-keys";

describe("getClerkKeys", () => {
  it("returns both keys when present", () => {
    const keys = getClerkKeys({
      CLERK_SECRET_KEY: "sk_test_secret",
      PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_publishable",
    });

    expect(keys).toStrictEqual({
      publishableKey: "pk_test_publishable",
      secretKey: "sk_test_secret",
    });
  });

  it("trims surrounding whitespace from both keys", () => {
    const keys = getClerkKeys({
      CLERK_SECRET_KEY: "  sk_test_secret  ",
      PUBLIC_CLERK_PUBLISHABLE_KEY: "\tpk_test_publishable\n",
    });

    expect(keys).toStrictEqual({
      publishableKey: "pk_test_publishable",
      secretKey: "sk_test_secret",
    });
  });

  it("throws when the publishable key is missing", () => {
    expect(() =>
      getClerkKeys({ CLERK_SECRET_KEY: "sk_test_secret" }),
    ).toThrow("PUBLIC_CLERK_PUBLISHABLE_KEY");
  });

  it("throws when the secret key is missing", () => {
    expect(() =>
      getClerkKeys({ PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_publishable" }),
    ).toThrow("CLERK_SECRET_KEY");
  });

  it("throws when a key is present but empty/whitespace", () => {
    expect(() =>
      getClerkKeys({
        CLERK_SECRET_KEY: " ".repeat(3),
        PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_publishable",
      }),
    ).toThrow("CLERK_SECRET_KEY");
  });
});
