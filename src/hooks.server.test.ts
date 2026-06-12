import type { Handle } from "@sveltejs/kit";

import { describe, expect, it, vi } from "vitest";

// Replace Clerk's request authentication with a pass-through so these tests
// exercise the real hook composition without live Clerk calls or keys.
vi.mock("svelte-clerk/server", () => {
  // eslint-disable-next-line unicorn/consistent-function-scoping -- pass-through handle must live inside the hoisted mock factory
  const passThrough: Handle = ({ event, resolve }) => resolve(event);
  return { withClerkHandler: () => passThrough };
});

// SvelteKit's real `sequence` depends on a per-request async store that only
// exists during live request handling. This faithful lightweight version
// threads `resolve` through each handle (last handle calls the original
// resolve) so the composition order can be unit-tested.
vi.mock("@sveltejs/kit/hooks", () => ({
  sequence:
    (...handles: Handle[]): Handle =>
    ({ event, resolve }) => {
      const apply = (index: number): ReturnType<Handle> => {
        const next = handles[index];
        if (!next) return resolve(event);
        return next({ event, resolve: () => apply(index + 1) });
      };
      return apply(0);
    },
}));

import { handle } from "./hooks.server";

type AppEvent = Parameters<typeof handle>[0]["event"];

function eventFor(url: string, extra: Partial<AppEvent> = {}): AppEvent {
  return {
    locals: { auth: () => ({ sessionId: null, userId: null }) },
    request: new Request(url),
    url: new URL(url),
    ...extra,
  } as unknown as AppEvent;
}

describe("handle", () => {
  it("routes API requests through Hono", async () => {
    const event = eventFor("https://rankings.trade/api/health", {
      platform: { env: { DB: {} } },
    } as unknown as Partial<AppEvent>);
    const resolve = vi.fn(() => new Response("SvelteKit route"));

    const response = await handle({ event, resolve });

    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("lets SvelteKit handle non-API requests", async () => {
    const event = eventFor("https://rankings.trade/");
    const expectedResponse = new Response("SvelteKit route");
    const resolve = vi.fn(() => expectedResponse);

    const response = await handle({ event, resolve });

    expect(response).toBe(expectedResponse);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("populates session locals from Clerk for non-API requests", async () => {
    const event = eventFor("https://rankings.trade/", {
      locals: { auth: () => ({ sessionId: "sess_1", userId: "user_1" }) },
    } as unknown as Partial<AppEvent>);
    const resolve = vi.fn(() => new Response("ok"));

    await handle({ event, resolve });

    expect(event.locals.userId).toBe("user_1");
    expect(event.locals.session).toStrictEqual({
      id: "sess_1",
      userId: "user_1",
    });
  });
});
