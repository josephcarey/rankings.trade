import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { clerkAuth, requireAuth, UNAUTHORIZED_ERROR } from "./auth";

/**
 * Builds a Hono app whose Clerk auth is faked: a middleware sets `clerkAuth`
 * (the function `getAuth` reads) to return the supplied auth object, so the
 * guard can be exercised without a live Clerk validation.
 */
function appWithFakeAuth(auth: { userId: string | null } | null) {
  const app = new Hono();

  app.use("*", async (context, next) => {
    context.set("clerkAuth", (() => auth) as never);

    await next();
  });
  app.use("*", requireAuth);
  app.get("/protected", (context) =>
    context.json({ userId: context.get("clerkAuth")()?.userId ?? null }),
  );

  return app;
}

describe("requireAuth", () => {
  it("passes through and exposes the identity when signed in", async () => {
    const app = appWithFakeAuth({ userId: "user_123" });

    const response = await app.request("/protected");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ userId: "user_123" });
  });

  it("returns a 401 with the studio error shape when signed out", async () => {
    const app = appWithFakeAuth({ userId: null });

    const response = await app.request("/protected");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(UNAUTHORIZED_ERROR);
  });

  it("returns a 401 when no Clerk auth is present", async () => {
    const app = appWithFakeAuth(null);

    const response = await app.request("/protected");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(UNAUTHORIZED_ERROR);
  });
});

describe("clerkAuth", () => {
  it("throws when the Clerk keys are missing from the env", () => {
    const context = { env: {} } as Parameters<typeof clerkAuth>[0];
    const next = vi.fn();

    expect(() => clerkAuth(context, next)).toThrow(/Clerk env var/);
    expect(next).not.toHaveBeenCalled();
  });
});
