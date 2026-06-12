import type { Handle } from "@sveltejs/kit";

import { describe, expect, it, vi } from "vitest";

import type { ClerkAuthResolver } from "./session";

import { clerkSessionHandle, toSessionLocals } from "./session";

type HandleArg = Parameters<Handle>[0];
type AppEvent = HandleArg["event"];

const signedIn = { sessionId: "sess_123", userId: "user_abc" };
const signedOut = { sessionId: null, userId: null };

function fakeEvent(): AppEvent {
  return { locals: {} } as unknown as AppEvent;
}

describe("toSessionLocals", () => {
  it("maps a signed-in auth object to a populated session", () => {
    expect(toSessionLocals(signedIn)).toStrictEqual({
      session: { id: "sess_123", userId: "user_abc" },
      userId: "user_abc",
    });
  });

  it("maps a signed-out auth object to null session and user id", () => {
    expect(toSessionLocals(signedOut)).toStrictEqual({
      session: null,
      userId: null,
    });
  });

  it("treats a user id without a session id as signed out", () => {
    expect(toSessionLocals({ sessionId: null, userId: "user_abc" })).toStrictEqual(
      { session: null, userId: null },
    );
  });
});

describe("clerkSessionHandle", () => {
  it("populates locals from a signed-in session and continues the chain", async () => {
    const event = fakeEvent();
    const response = new Response("ok");
    const resolve = vi.fn(async () => response);

    const result = await clerkSessionHandle(() => signedIn)({ event, resolve });

    expect(event.locals.userId).toBe("user_abc");
    expect(event.locals.session).toStrictEqual({
      id: "sess_123",
      userId: "user_abc",
    });
    expect(resolve).toHaveBeenCalledWith(event);
    expect(result).toBe(response);
  });

  it("populates null locals for a signed-out request", async () => {
    const event = fakeEvent();
    const resolve = vi.fn(async () => new Response("ok"));

    await clerkSessionHandle(() => signedOut)({ event, resolve });

    expect(event.locals.userId).toBeNull();
    expect(event.locals.session).toBeNull();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("reads the Clerk auth from the injected resolver, passing the event through", async () => {
    const event = fakeEvent();
    const resolve = vi.fn(async () => new Response("ok"));
    const resolveAuth = vi.fn<ClerkAuthResolver>(() => signedIn);

    await clerkSessionHandle(resolveAuth)({ event, resolve });

    expect(resolveAuth).toHaveBeenCalledWith(event);
  });
});
