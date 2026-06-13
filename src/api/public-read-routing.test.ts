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
import { createPublicReadApi } from "./public-read";

const migrationsDir = fileURLToPath(
  new URL("../../migrations", import.meta.url),
);

/**
 * Locks in the production mount order on the shared `/agents` surface (see src/api/app.ts):
 *   1. ingestion router (Epic F bot POSTs)   — terminal, token-guarded
 *   2. public-read router (Epic M public GET) — this epic
 *   3. Clerk agents router (Epic C/sessions)  — `use("*")` guarded
 *
 * The Clerk router is deliberately NOT exercised here: its middleware needs real Clerk keys
 * (absent in tests). Instead, the two invariants are proven separately, mirroring the existing
 * ingestion-routing test: (a) with the Clerk router present, public GETs and F's POSTs resolve
 * before it is ever consulted; (b) routes the Clerk router owns are DECLINED (404) by the
 * ingestion + public-read pair, so they fall through to Clerk in production.
 */
let db: D1Database;
let rawToken: string;

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

function withEnv(api: Hono<{ Bindings: CloudflareBindings }>) {
  api.use("*", async (context, next) => {
    context.env = { DB: db } as never;
    await next();
  });
  return api;
}

/** Full production order, including the Clerk router. */
function fullApi() {
  const api = withEnv(new Hono<{ Bindings: CloudflareBindings }>());
  api.route("/agents", createIngestionApi());
  api.route("/", createPublicReadApi());
  api.route("/agents", createAgentsApi());
  return api;
}

/** Production order minus Clerk: a 404 here proves the request falls through to Clerk. */
function noClerkApi() {
  const api = withEnv(new Hono<{ Bindings: CloudflareBindings }>());
  api.route("/agents", createIngestionApi());
  api.route("/", createPublicReadApi());
  return api;
}

describe("/agents coexistence (ingestion + public-read + Clerk)", () => {
  it("serves the public GET /agents/:symbol before the Clerk router is reached", async () => {
    const res = await fullApi().request("/agents/RANKBOT");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).agent.symbol).toBe("RANKBOT");
  });

  it("still routes F's bot POST /agents/:symbol/logs to ingestion (201)", async () => {
    const res = await fullApi().request("/agents/RANKBOT/logs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rawToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "via bot token" }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).log.text).toBe("via bot token");
  });

  it("still routes F's bot POST /agents/:symbol/milestones to ingestion (201)", async () => {
    const res = await fullApi().request("/agents/RANKBOT/milestones", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rawToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "first-jump" }),
    });
    expect(res.status).toBe(201);
  });

  it("serves the other public reads (universe/seasons) without touching /agents", async () => {
    const universe = await fullApi().request("/universe/leaderboard");
    expect(universe.status).toBe(200);
    const seasons = await fullApi().request("/seasons/current");
    expect(seasons.status).toBe(200);
  });
});

describe("/agents fall-through (ingestion + public-read decline Clerk routes)", () => {
  it("does not serve the Clerk owned-agents list GET /agents/", async () => {
    const res = await noClerkApi().request("/agents/");
    expect(res.status).toBe(404);
  });

  it("does not serve the Clerk tokens route GET /agents/:symbol/tokens", async () => {
    const res = await noClerkApi().request("/agents/RANKBOT/tokens");
    expect(res.status).toBe(404);
  });

  it("public-read's GET /agents/:symbol does not shadow the deeper tokens path", async () => {
    // /agents/:symbol must NOT match /agents/:symbol/tokens (different depth).
    const shallow = await noClerkApi().request("/agents/RANKBOT");
    expect(shallow.status).toBe(200);
    const deep = await noClerkApi().request("/agents/RANKBOT/tokens");
    expect(deep.status).toBe(404);
  });
});
