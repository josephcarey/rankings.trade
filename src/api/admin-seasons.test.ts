/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { AuthedVariables } from "./auth";

import { loadMigrations } from "../lib/db/loader";
import { runMigrations } from "../lib/db/migrate";
import { getOpenSeason } from "../lib/db/seasons";
import { createSqliteD1 } from "../lib/db/sqlite-d1-adapter";
import {
  createSeasonHandler,
  listSeasonsHandler,
  updateSeasonHandler,
} from "./admin";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));
const ADMIN_ENV = "user_admin";

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

/** Mount the season handlers behind a stubbed Clerk identity (admin or not). */
function seasonsApp(db: D1Database, clerkUserId: string) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (context, next) => {
    context.env = { ADMIN_CLERK_USER_IDS: ADMIN_ENV, DB: db } as never;
    context.set("clerkAuth", (() => ({ userId: clerkUserId })) as never);
    await next();
  });
  app.get("/seasons", listSeasonsHandler as never);
  app.post("/seasons", createSeasonHandler as never);
  app.patch("/seasons/:id", updateSeasonHandler as never);
  return app;
}

function send(
  app: Hono<{ Variables: AuthedVariables }>,
  method: string,
  url: string,
  body?: unknown,
) {
  const init: RequestInit = { headers: { "content-type": "application/json" }, method };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.request(url, init);
}

describe("admin season endpoints", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("rejects a non-admin caller with 403", async () => {
    const app = seasonsApp(db, "user_alice");
    for (const r of [
      send(app, "GET", "/seasons"),
      send(app, "POST", "/seasons", { label: "S1", cutoff_date: "2026-09-01" }),
    ]) {
      const response = await r;
      expect(response.status).toBe(403);
    }
  });

  it("creates an open season for an admin", async () => {
    const app = seasonsApp(db, "user_admin");
    const response = await send(app, "POST", "/seasons", {
      label: "Season 1",
      cutoff_date: "2026-09-01",
      unranked_gap_days: 7,
    });
    expect(response.status).toBe(201);
    const json: any = await response.json();
    expect(json.season.label).toBe("Season 1");
    expect(json.season.unranked_gap_days).toBe(7);
    expect((await getOpenSeason(db))!.id).toBe(json.season.id);
  });

  it("rejects a second open season with 409", async () => {
    const app = seasonsApp(db, "user_admin");
    await send(app, "POST", "/seasons", { label: "S1", cutoff_date: "2026-09-01" });
    const response = await send(app, "POST", "/seasons", {
      label: "S2",
      cutoff_date: "2026-10-01",
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as any).error.code).toBe("open_season_exists");
  });

  it("rejects an invalid cutoff date with 400", async () => {
    const app = seasonsApp(db, "user_admin");
    const response = await send(app, "POST", "/seasons", {
      label: "S1",
      cutoff_date: "not-a-date",
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.code).toBe("invalid_cutoff");
  });

  it("updates the open season's cutoff and gap", async () => {
    const app = seasonsApp(db, "user_admin");
    const createResponse = await send(app, "POST", "/seasons", {
      label: "S1",
      cutoff_date: "2026-09-01",
    });
    const created: any = await createResponse.json();
    const response = await send(app, "PATCH", `/seasons/${created.season.id}`, {
      cutoff_date: "2026-09-15",
      unranked_gap_days: 3,
    });
    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.season.cutoff_date).toBe("2026-09-15");
    expect(json.season.unranked_gap_days).toBe(3);
  });

  it("returns 404 when updating an unknown season", async () => {
    const app = seasonsApp(db, "user_admin");
    const response = await send(app, "PATCH", "/seasons/999", { unranked_gap_days: 1 });
    expect(response.status).toBe(404);
  });

  it("lists seasons newest first", async () => {
    const app = seasonsApp(db, "user_admin");
    const firstResponse = await send(app, "POST", "/seasons", {
      label: "S1",
      cutoff_date: "2026-09-01",
    });
    const first: any = await firstResponse.json();
    // Close S1 so a second can be opened.
    await db
      .prepare("UPDATE seasons SET closed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(first.season.id)
      .run();
    await send(app, "POST", "/seasons", { label: "S2", cutoff_date: "2026-10-01" });

    const listResponse = await send(app, "GET", "/seasons");
    const json: any = await listResponse.json();
    expect(json.seasons.map((s: any) => s.label)).toEqual(["S2", "S1"]);
  });
});
