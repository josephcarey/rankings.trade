import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { User } from "../lib/db/users";
import type { AuthedVariables } from "./auth";

import { ownedAgentsHandler } from "./agents";
import { requireAuth, UNAUTHORIZED_ERROR } from "./auth";

const USER: User = {
  id: 7,
  clerk_user_id: "user_7",
  email: "pilot@example.com",
  display_name: "Pilot",
  visibility: "public",
  dashboard_url: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const AGENTS = [
  { id: 2, symbol: "RANKBOT", verified: 0, owner_user_id: 7 },
  { id: 1, symbol: "OLDBOT", verified: 1, owner_user_id: 7 },
];

// Fake D1 whose `.all()` echoes the owned agents (the listing query).
const fakeDb = {
  prepare: () => ({
    bind: () => ({
      all: () => Promise.resolve({ results: AGENTS, success: true }),
    }),
  }),
} as unknown as D1Database;

describe("ownedAgentsHandler", () => {
  it("returns the caller's agents as JSON", async () => {
    const app = new Hono<{ Variables: AuthedVariables }>();
    app.use("*", async (context, next) => {
      context.env = { DB: fakeDb } as never;
      context.set("user", USER);
      await next();
    });
    app.get("/", ownedAgentsHandler as never);

    const response = await app.request("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ agents: AGENTS });
  });
});

describe("/api/agents guard", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = new Hono();
    // Fake the Clerk auth slot as signed-out, then run the real guard.
    app.use("*", async (context, next) => {
      context.set("clerkAuth", (() => ({ userId: null })) as never);
      await next();
    });
    app.use("*", requireAuth);
    app.get("/", ownedAgentsHandler as never);

    const response = await app.request("/");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(UNAUTHORIZED_ERROR);
  });
});
