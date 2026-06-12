import { describe, expect, it, vi } from "vitest";

vi.mock("svelte-clerk/server", () => ({
  buildClerkProps: vi.fn(() => ({ initialState: { fake: true } })),
}));

import { load } from "./+layout.server";

type Locals = {
  userId: string | null;
  auth: () => unknown;
};

function run(locals: Locals) {
  return load({ locals } as Parameters<typeof load>[0]);
}

describe("layout load", () => {
  it("merges Clerk SSR props with signed-in nav state", async () => {
    const result = await run({ userId: "user_123", auth: () => ({}) });

    expect(result).toEqual({
      initialState: { fake: true },
      nav: { signedIn: true, userId: "user_123" },
    });
  });

  it("reports signed-out nav state for a guest", async () => {
    const result = await run({ userId: null, auth: () => ({}) });

    expect(result).toMatchObject({ nav: { signedIn: false, userId: null } });
  });
});
