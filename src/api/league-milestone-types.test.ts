/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { User } from "../lib/db/users";
import type { AuthedVariables } from "./auth";

import { loadMigrations } from "../lib/db/loader";
import { runMigrations } from "../lib/db/migrate";
import { createSqliteD1 } from "../lib/db/sqlite-d1-adapter";
import { listTypesHandler, registerTypeHandler } from "./league-milestone-types";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));

const ADMIN_ENV = "user_admin";

function fakeUser(id: number, clerkId: string): User {
  return {
    id,
    clerk_user_id: clerkId,
    email: null,
    display_name: null,
    visibility: "public",
    dashboard_url: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

let db: D1Database;
let leagueId: number;

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const sqlite = createSqliteD1(new SQL.Database());
  const result = await runMigrations(sqlite, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return sqlite;
}

function app(clerkUserId: string, actor: User) {
  const a = new Hono<{ Variables: AuthedVariables }>();
  a.use("*", async (context, next) => {
    context.env = { ADMIN_CLERK_USER_IDS: ADMIN_ENV, DB: db } as never;
    context.set("clerkAuth", (() => ({ userId: clerkUserId })) as never);
    context.set("user", actor);
    await next();
  });
  a.get("/:id/milestone-types", listTypesHandler as never);
  a.post("/:id/milestone-types", registerTypeHandler as never);
  return a;
}

function postType(clerkId: string, actor: User, id: number | string, body: unknown) {
  return app(clerkId, actor).request(`/${id}/milestone-types`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  db = await makeDb();
  const row = await db
    .prepare(
      "INSERT INTO leagues (name, visibility, owner_user_id) VALUES ('L', 'private', 1) RETURNING id",
    )
    .first<{ id: number }>();
  leagueId = row?.id ?? 0;
});

const OWNER = fakeUser(1, "user_owner");
const STRANGER = fakeUser(2, "user_stranger");
const ADMIN = fakeUser(99, "user_admin");

describe("POST /:id/milestone-types", () => {
  it("registers a custom type for the owner (201)", async () => {
    const response = await postType("user_owner", OWNER, leagueId, { key: "Boss-Down", label: "Boss Down" });
    expect(response.status).toBe(201);
    expect(((await response.json()) as any).type.key).toBe("boss-down");
  });

  it("lets an admin register (201)", async () => {
    const response = await postType("user_admin", ADMIN, leagueId, { key: "boss-down" });
    expect(response.status).toBe(201);
  });

  it("hides the league from a stranger (404, IDOR-safe)", async () => {
    const response = await postType("user_stranger", STRANGER, leagueId, { key: "boss-down" });
    expect(response.status).toBe(404);
  });

  it("rejects a malformed key (400)", async () => {
    const response = await postType("user_owner", OWNER, leagueId, { key: "Bad Key!" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.code).toBe("invalid_type");
  });

  it("reports a duplicate (409)", async () => {
    await postType("user_owner", OWNER, leagueId, { key: "boss-down" });
    const dup = await postType("user_owner", OWNER, leagueId, { key: "boss-down" });
    expect(dup.status).toBe(409);
  });

  it("rejects a non-numeric league id (404)", async () => {
    const response = await postType("user_owner", OWNER, "abc", { key: "boss-down" });
    expect(response.status).toBe(404);
  });
});

describe("GET /:id/milestone-types", () => {
  it("lists the owner's custom types", async () => {
    await postType("user_owner", OWNER, leagueId, { key: "boss-down" });
    const response = await app("user_owner", OWNER).request(`/${leagueId}/milestone-types`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).types.map((t: any) => t.key)).toEqual(["boss-down"]);
  });

  it("hides the list from a stranger (404)", async () => {
    const response = await app("user_stranger", STRANGER).request(`/${leagueId}/milestone-types`);
    expect(response.status).toBe(404);
  });
});
