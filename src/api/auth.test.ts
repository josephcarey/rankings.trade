import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { ClerkUserLike } from "../lib/auth/clerk-identity";
import type { User } from "../lib/db/users";

import {
  clerkAuth,
  createAttachLocalUser,
  requireAuth,
  UNAUTHORIZED_ERROR,
} from "./auth";

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

describe("createAttachLocalUser", () => {
  const CLERK_USER: ClerkUserLike = {
    id: "user_123",
    emailAddresses: [{ emailAddress: "ada@example.com", id: "e1" }],
    firstName: "Ada",
    lastName: "Lovelace",
    primaryEmailAddressId: "e1",
    username: null,
  };

  const PROVISIONED: User = {
    id: 1,
    clerk_user_id: "user_123",
    email: "ada@example.com",
    display_name: "Ada Lovelace",
    visibility: "public",
    dashboard_url: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };

  // Fake D1 that echoes the provisioned row back from `first()`.
  const fakeDb = {
    prepare: () => ({
      bind: () => ({
        run: () => Promise.resolve({ success: true }),
        first: () => Promise.resolve(PROVISIONED),
      }),
    }),
  } as unknown as D1Database;

  function appWith(authUserId: string | null, fetchClerkUser = vi.fn((_userId: string) => Promise.resolve(CLERK_USER))) {
    const attach = createAttachLocalUser({
      fetchClerkUser: (_context, userId) => fetchClerkUser(userId),
      getDb: () => fakeDb,
    });
    const app = new Hono<{ Variables: { user: User } }>();

    app.use("*", async (context, next) => {
      context.set("clerkAuth", (() => ({ userId: authUserId })) as never);
      await next();
    });
    app.use("*", attach as never);
    app.get("/me", (context) => context.json({ user: context.get("user") ?? null }));

    return { app, fetchClerkUser };
  }

  it("provisions and attaches the local user for a verified identity", async () => {
    const { app } = appWith("user_123");

    const response = await app.request("/me");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ user: PROVISIONED });
  });
});
