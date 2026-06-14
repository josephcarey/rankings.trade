import { describe, expect, it, vi } from "vitest";

vi.mock("svelte-clerk/server", () => ({
  buildClerkProps: vi.fn(() => ({ initialState: { fake: true } })),
}));

import { load } from "./+layout.server";

type Locals = {
  userId: string | null;
  user?: { id: number } | null;
  auth: () => unknown;
};

type RunOptions = {
  themeCookie?: string;
  db?: unknown;
};

function run(locals: Locals, { themeCookie, db }: RunOptions = {}) {
  return load({
    locals,
    cookies: { get: () => themeCookie },
    platform: db ? { env: { DB: db } } : undefined,
  } as unknown as Parameters<typeof load>[0]);
}

describe("layout load", () => {
  it("merges Clerk SSR props with signed-in nav state", async () => {
    const result = await run({ userId: "user_123", auth: () => ({}) });

    expect(result).toEqual({
      initialState: { fake: true },
      nav: { signedIn: true, userId: "user_123" },
      theme: "system",
      leagues: [],
    });
  });

  it("reports signed-out nav state for a guest", async () => {
    const result = await run({ userId: null, auth: () => ({}) });

    expect(result).toMatchObject({
      nav: { signedIn: false, userId: null },
      theme: "system",
      leagues: [],
    });
  });

  it("reflects the persisted theme cookie", async () => {
    const result = await run(
      { userId: null, auth: () => ({}) },
      { themeCookie: "dark" },
    );

    expect(result).toMatchObject({ theme: "dark" });
  });

  it("loads the user's leagues (id + name only) when signed in with a DB", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: () =>
            Promise.resolve({
              results: [
                { id: 7, name: "Alpha", visibility: "private", extra: "drop" },
              ],
            }),
        }),
      }),
    };

    const result = await run(
      { userId: "user_1", user: { id: 1 }, auth: () => ({}) },
      { db },
    );

    expect(result).toMatchObject({ leagues: [{ id: 7, name: "Alpha" }] });
  });
});
