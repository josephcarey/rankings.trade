import { describe, expect, it } from "vitest";

import type { ClerkUserLike } from "./clerk-identity";

import { clerkIdentity } from "./clerk-identity";

function makeUser(overrides: Partial<ClerkUserLike> = {}): ClerkUserLike {
  return {
    id: "user_1",
    emailAddresses: [],
    firstName: null,
    lastName: null,
    primaryEmailAddressId: null,
    username: null,
    ...overrides,
  };
}

describe("clerkIdentity", () => {
  it("uses the primary email address", () => {
    const identity = clerkIdentity(
      makeUser({
        emailAddresses: [
          {
            emailAddress: "secondary@example.com",
            id: "e2",
            verification: { status: "verified" },
          },
          {
            emailAddress: "primary@example.com",
            id: "e1",
            verification: { status: "verified" },
          },
        ],
        primaryEmailAddressId: "e1",
      }),
    );

    expect(identity.email).toBe("primary@example.com");
  });

  it("falls back to the first email when no primary is set", () => {
    const identity = clerkIdentity(
      makeUser({
        emailAddresses: [
          {
            emailAddress: "first@example.com",
            id: "e1",
            verification: { status: "verified" },
          },
        ],
      }),
    );

    expect(identity.email).toBe("first@example.com");
  });

  it("returns null email when there are no addresses", () => {
    expect(clerkIdentity(makeUser()).email).toBeNull();
  });

  it("reports email_verified true when the chosen address is verified", () => {
    const identity = clerkIdentity(
      makeUser({
        emailAddresses: [
          {
            emailAddress: "primary@example.com",
            id: "e1",
            verification: { status: "verified" },
          },
        ],
        primaryEmailAddressId: "e1",
      }),
    );

    expect(identity.email_verified).toBe(true);
  });

  it("reports email_verified false when the chosen address is unverified", () => {
    const identity = clerkIdentity(
      makeUser({
        emailAddresses: [
          {
            emailAddress: "primary@example.com",
            id: "e1",
            verification: { status: "unverified" },
          },
        ],
        primaryEmailAddressId: "e1",
      }),
    );

    expect(identity.email_verified).toBe(false);
  });

  it("reports email_verified false when verification is missing", () => {
    const identity = clerkIdentity(
      makeUser({
        emailAddresses: [
          { emailAddress: "primary@example.com", id: "e1", verification: null },
        ],
        primaryEmailAddressId: "e1",
      }),
    );

    expect(identity.email_verified).toBe(false);
  });

  it("builds display_name from first and last name", () => {
    const identity = clerkIdentity(
      makeUser({ firstName: "Ada", lastName: "Lovelace" }),
    );

    expect(identity.display_name).toBe("Ada Lovelace");
  });

  it("falls back to username when no name is present", () => {
    const identity = clerkIdentity(makeUser({ username: "ada" }));

    expect(identity.display_name).toBe("ada");
  });

  it("returns null display_name when neither name nor username exists", () => {
    expect(clerkIdentity(makeUser()).display_name).toBeNull();
  });

  it("carries the Clerk user id through", () => {
    expect(clerkIdentity(makeUser({ id: "user_xyz" })).clerk_user_id).toBe(
      "user_xyz",
    );
  });
});
