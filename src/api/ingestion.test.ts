/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { IngestionEnv } from "./ingestion";

import { generateToken } from "../lib/agents/token";
import { insertToken } from "../lib/db/agent-tokens";
import { createAgent } from "../lib/db/agents";
import { listLogsByAgent } from "../lib/db/logs";
import { loadMigrations } from "../lib/db/loader";
import { runMigrations } from "../lib/db/migrate";
import { listMilestonesByAgent } from "../lib/db/milestones";
import { createSqliteD1 } from "../lib/db/sqlite-d1-adapter";
import { createIngestionApi } from "./ingestion";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));

let db: D1Database;
let rawToken: string;
let agentId: number;

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const sqlite = createSqliteD1(new SQL.Database());
  const result = await runMigrations(sqlite, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return sqlite;
}

function app(now?: () => Date) {
  const a = new Hono<IngestionEnv>();
  a.use("*", async (context, next) => {
    context.env = { DB: db } as never;
    await next();
  });
  a.route("/", createIngestionApi(now ? { now } : {}));
  return a;
}

function post(path: string, body: unknown, auth?: string, headers: Record<string, string> = {}) {
  return app().request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  db = await makeDb();
  const agent = await createAgent(db, { symbol: "RANKBOT", owner_user_id: 7 });
  agentId = agent.id;
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

describe("POST /:symbol/logs", () => {
  it("rejects a request with no token (401)", async () => {
    const response = await post("/RANKBOT/logs", { text: "hi" });
    expect(response.status).toBe(401);
  });

  it("rejects a token used for another agent's callsign (403)", async () => {
    const response = await post("/OTHERBOT/logs", { text: "hi" }, `Bearer ${rawToken}`);
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error.code).toBe("forbidden");
    expect((await listLogsByAgent(db, agentId)).length).toBe(0);
  });

  it("stores a valid log (201) and is case-insensitive on the symbol", async () => {
    const response = await post("/rankbot/logs", { text: "jumped" }, `Bearer ${rawToken}`);
    expect(response.status).toBe(201);
    expect(((await response.json()) as any).log.text).toBe("jumped");
  });

  it("rejects empty text (400)", async () => {
    const response = await post("/RANKBOT/logs", { text: "  " }, `Bearer ${rawToken}`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.code).toBe("invalid_text");
  });

  it("rejects an unparseable body (400)", async () => {
    const response = await post("/RANKBOT/logs", "{not json", `Bearer ${rawToken}`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.code).toBe("invalid_json");
  });

  it("rejects an over-cap Content-Length (413)", async () => {
    const response = await post("/RANKBOT/logs", { text: "hi" }, `Bearer ${rawToken}`, {
      "Content-Length": "999999",
    });
    expect(response.status).toBe(413);
  });

  it("rejects an actually-oversized body even without Content-Length (413)", async () => {
    const huge = JSON.stringify({ text: "x".repeat(20_000) });
    const response = await app().request("/RANKBOT/logs", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawToken}` },
      body: huge,
    });
    expect(response.status).toBe(413);
  });
});

describe("POST /:symbol/milestones", () => {
  it("TOLERANTLY stores an unknown type (201)", async () => {
    const response = await post(
      "/RANKBOT/milestones",
      { type: "warp-core-online", metadata: { sector: "X1" } },
      `Bearer ${rawToken}`,
    );
    expect(response.status).toBe(201);
    const stored = await listMilestonesByAgent(db, agentId);
    expect(stored[0]?.type).toBe("warp-core-online");
    expect(stored[0]?.metadata).toBe('{"sector":"X1"}');
  });

  it("rejects a malformed type (400)", async () => {
    const response = await post("/RANKBOT/milestones", { type: "bad type!" }, `Bearer ${rawToken}`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.code).toBe("invalid_type");
  });

  it("rejects non-object metadata (400)", async () => {
    const response = await post(
      "/RANKBOT/milestones",
      { type: "first-jump", metadata: [1, 2, 3] },
      `Bearer ${rawToken}`,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.code).toBe("invalid_metadata");
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the per-token limit is exceeded", async () => {
    const fixed = new Date("2026-06-12T12:00:10Z");
    const limited = app(() => fixed);
    // Default limit is 60/min — fire 60 OK then expect the 61st to 429.
    for (let i = 0; i < 60; i++) {
      const ok = await limited.request("/RANKBOT/logs", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: `n${i}` }),
      });
      expect(ok.status).toBe(201);
    }
    const blocked = await limited.request("/RANKBOT/logs", {
      method: "POST",
      headers: { Authorization: `Bearer ${rawToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "over" }),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("50");
  });
});
