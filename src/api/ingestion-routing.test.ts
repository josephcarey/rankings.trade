/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { CloudflareBindings } from "../platform";

import { generateToken } from "../lib/agents/token";
import { insertToken } from "../lib/db/agent-tokens";
import { createAgent } from "../lib/db/agents";
import { loadMigrations } from "../lib/db/loader";
import { runMigrations } from "../lib/db/migrate";
import { createSqliteD1 } from "../lib/db/sqlite-d1-adapter";
import { createAgentsApi } from "./agents";
import { createIngestionApi } from "./ingestion";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));

/**
 * Reproduces the production mount order: the bot-token ingestion router is mounted
 * on `/agents` BEFORE the Clerk-session agents router. These tests lock in the
 * invariant that a bot POST reaches the ingestion handler without invoking Clerk
 * auth, while the Clerk GET routes remain guarded.
 */
let db: D1Database;
let rawToken: string;

async function makeApi() {
  const api = new Hono<{ Bindings: CloudflareBindings }>();
  api.use("*", async (context, next) => {
    context.env = { DB: db } as never;
    await next();
  });
  api.route("/agents", createIngestionApi());
  api.route("/agents", createAgentsApi());
  return api;
}

beforeEach(async () => {
  const SQL = await Database();
  db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
  const generated = await generateToken();
  await insertToken(db, {
    agent_id: agent.id,
    owner_user_id: 7,
    token_hash: generated.hash,
    token_prefix: generated.prefix,
    label: "bot",
  });
  rawToken = generated.token;
});

describe("/agents mount order", () => {
  it("routes a bot POST to ingestion with no Clerk session (201)", async () => {
    const api = await makeApi();
    const response = await api.request("/agents/RANKBOT/logs", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "via bot token" }),
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as any).log.text).toBe("via bot token");
  });

  it("a bot POST without a token fails bot auth (401), not Clerk", async () => {
    const api = await makeApi();
    const response = await api.request("/agents/RANKBOT/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x" }),
    });
    expect(response.status).toBe(401);
    // The bot-auth envelope, not the Clerk one.
    expect(((await response.json()) as any).error.message).toContain("agent API token");
  });

  it("does not shadow the Clerk GET routes (ingestion declines them with 404)", async () => {
    // Mount ONLY the ingestion router: it defines no GET routes, so GETs return
    // 404 and fall through to the Clerk agents router in production. This proves
    // the bot router cannot accidentally serve or bypass the Clerk read routes.
    const api = new Hono<{ Bindings: CloudflareBindings }>();
    api.use("*", async (context, next) => {
      context.env = { DB: db } as never;
      await next();
    });
    api.route("/agents", createIngestionApi());

    const slashRes = await api.request("/agents/");
    expect(slashRes.status).toBe(404);
    const tokensRes = await api.request("/agents/RANKBOT/tokens");
    expect(tokensRes.status).toBe(404);
    // A POST it DOES own still works, confirming the router is live.
    const owned = await api.request("/agents/RANKBOT/milestones", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "first-jump" }),
    });
    expect(owned.status).toBe(201);
  });
});
