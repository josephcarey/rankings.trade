/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { User } from "../lib/db/users";
import type { AuthedVariables } from "./auth";

import { createAgent } from "../lib/db/agents";
import { loadMigrations } from "../lib/db/loader";
import { insertLog, listLogsByAgent } from "../lib/db/logs";
import { runMigrations } from "../lib/db/migrate";
import { insertMilestone } from "../lib/db/milestones";
import { createSqliteD1 } from "../lib/db/sqlite-d1-adapter";
import {
  deleteLogHandler,
  deleteMilestoneHandler,
  listLogsHandler,
  listMilestonesHandler,
} from "./moderation";

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

const OWNER = fakeUser(7, "user_owner");
const STRANGER = fakeUser(2, "user_stranger");
const ADMIN = fakeUser(99, "user_admin");

let db: D1Database;
let agentId: number;

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
  a.get("/agents/:symbol/logs", listLogsHandler as never);
  a.get("/agents/:symbol/milestones", listMilestonesHandler as never);
  a.delete("/logs/:id", deleteLogHandler as never);
  a.delete("/milestones/:id", deleteMilestoneHandler as never);
  return a;
}

function del(clerkId: string, actor: User, path: string) {
  return app(clerkId, actor).request(path, { method: "DELETE" });
}

beforeEach(async () => {
  db = await makeDb();
  const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
  agentId = agent.id;
});

describe("DELETE /logs/:id", () => {
  let logId: number;
  beforeEach(async () => {
    const log = await insertLog(db, { agent_id: agentId, text: "spam" });
    logId = log.id;
  });

  it("lets the owner delete (200) and hides it from reads", async () => {
    const response = await del("user_owner", OWNER, `/logs/${logId}`);
    expect(response.status).toBe(200);
    const logs = await listLogsByAgent(db, agentId);
    expect(logs.length).toBe(0);
  });

  it("lets an admin delete (200)", async () => {
    const response = await del("user_admin", ADMIN, `/logs/${logId}`);
    expect(response.status).toBe(200);
  });

  it("hides another owner's log from a stranger (404, IDOR) without deleting", async () => {
    const response = await del("user_stranger", STRANGER, `/logs/${logId}`);
    expect(response.status).toBe(404);
    const logs = await listLogsByAgent(db, agentId);
    expect(logs.length).toBe(1);
  });

  it("returns 404 for an unknown id", async () => {
    const response = await del("user_owner", OWNER, "/logs/9999");
    expect(response.status).toBe(404);
  });

  it("returns 404 for a non-numeric id", async () => {
    const response = await del("user_owner", OWNER, "/logs/abc");
    expect(response.status).toBe(404);
  });
});

describe("DELETE /milestones/:id", () => {
  it("lets the owner delete (200), strangers get 404", async () => {
    const milestone = await insertMilestone(db, {
      agent_id: agentId,
      type: "first-jump",
      metadata: null,
    });
    const strangerRes = await del("user_stranger", STRANGER, `/milestones/${milestone.id}`);
    expect(strangerRes.status).toBe(404);
    const ownerRes = await del("user_owner", OWNER, `/milestones/${milestone.id}`);
    expect(ownerRes.status).toBe(200);
  });
});

describe("GET /agents/:symbol/logs", () => {
  it("returns the owner's logs and 404s a stranger", async () => {
    await insertLog(db, { agent_id: agentId, text: "one" });
    const owner = await app("user_owner", OWNER).request("/agents/RANKBOT/logs");
    expect(owner.status).toBe(200);
    expect(((await owner.json()) as any).logs.length).toBe(1);
    const stranger = await app("user_stranger", STRANGER).request("/agents/RANKBOT/logs");
    expect(stranger.status).toBe(404);
  });
});

describe("GET /agents/:symbol/milestones", () => {
  it("returns the owner's milestones and 404s a stranger", async () => {
    await insertMilestone(db, { agent_id: agentId, type: "first-jump", metadata: null });
    const owner = await app("user_owner", OWNER).request("/agents/RANKBOT/milestones");
    expect(owner.status).toBe(200);
    expect(((await owner.json()) as any).milestones.length).toBe(1);
    const stranger = await app("user_stranger", STRANGER).request("/agents/RANKBOT/milestones");
    expect(stranger.status).toBe(404);
  });
});
