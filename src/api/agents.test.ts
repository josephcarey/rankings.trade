/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { User } from "../lib/db/users";
import type { AuthedVariables } from "./auth";

import { createAgent } from "../lib/db/agents";
import {
  createTokenHandler,
  listTokensHandler,
  ownedAgentsHandler,
  revokeTokenHandler,
  rotateTokenHandler,
} from "./agents";
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

// ---------------------------------------------------------------------------
// Token-management routes over a real in-memory D1 (HTTP status + body shape).
// ---------------------------------------------------------------------------

class TokenApiStatement {
  private bindings: unknown[] = [];
  constructor(
    private sql: string,
    private db: any,
  ) {}
  async all<T>(): Promise<{ results: T[]; success: true }> {
    const results = this.db.exec(this.sql, this.bindings);
    if (results.length === 0 || !results[0]) return { results: [], success: true };
    const columns = results[0].columns as string[];
    const rows = (results[0].values as unknown[][]).map((values) => {
      const row: Record<string, unknown> = {};
      for (const [index, col] of columns.entries()) row[col] = values[index];
      return row as T;
    });
    return { results: rows, success: true };
  }
  bind(...params: unknown[]) {
    this.bindings = params;
    return this;
  }
  async first<T>(): Promise<T | undefined> {
    const results = this.db.exec(this.sql, this.bindings);
    if (results.length > 0 && results[0]?.values?.length > 0) {
      const columns = results[0].columns as string[];
      const values = results[0].values[0] as unknown[];
      const row: Record<string, unknown> = {};
      for (const [index, col] of columns.entries()) row[col] = values[index];
      return row as T;
    }
    return undefined;
  }
  async run() {
    this.db.run(this.sql, this.bindings);
    return { success: true };
  }
}

class TokenApiDatabase {
  constructor(private db: any) {}
  prepare(sql: string) {
    return new TokenApiStatement(sql, this.db);
  }
}

const TOKEN_SCHEMA = `
  CREATE TABLE agents (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    symbol        TEXT     NOT NULL UNIQUE,
    display_name  TEXT     NULL,
    owner_user_id INTEGER  NULL,
    verified      INTEGER  NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE agent_tokens (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    agent_id      INTEGER  NOT NULL,
    owner_user_id INTEGER  NOT NULL,
    token_hash    TEXT     NOT NULL UNIQUE,
    token_prefix  TEXT     NOT NULL,
    label         TEXT     NOT NULL CHECK (LENGTH(label) BETWEEN 1 AND 60),
    last_used_at  DATETIME NULL,
    revoked_at    DATETIME NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

function post(
  app: Hono<{ Variables: AuthedVariables }>,
  url: string,
  body: unknown = {},
) {
  return app.request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("agent token API routes", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(TOKEN_SCHEMA);
    db = new TokenApiDatabase(sqliteDb) as unknown as D1Database;
    await createAgent(db, { owner_user_id: 7, symbol: "RANKBOT" });
    await createAgent(db, { owner_user_id: 99, symbol: "OTHERBOT" });
  });

  function appAs(user: User) {
    const app = new Hono<{ Variables: AuthedVariables }>();
    app.use("*", async (context, next) => {
      context.env = { DB: db } as never;
      context.set("user", user);
      await next();
    });
    app.get("/:symbol/tokens", listTokensHandler as never);
    app.post("/:symbol/tokens", createTokenHandler as never);
    app.post("/:symbol/tokens/:id/revoke", revokeTokenHandler as never);
    app.post("/:symbol/tokens/:id/rotate", rotateTokenHandler as never);
    return app;
  }

  it("creates a token (201) returning the raw secret and a hash-free record", async () => {
    const app = appAs(USER);
    const response = await post(app, "/RANKBOT/tokens", { label: "CI" });

    expect(response.status).toBe(201);
    const json: any = await response.json();
    expect(json.token).toMatch(/^rtbot_/);
    expect(json.record.label).toBe("CI");
    expect(json.record).not.toHaveProperty("token_hash");
  });

  it("rejects an invalid label with 400", async () => {
    const app = appAs(USER);
    const response = await post(app, "/RANKBOT/tokens", { label: "" });
    expect(response.status).toBe(400);
    const json: any = await response.json();
    expect(json.error.code).toBe("invalid_label");
  });

  it("returns 404 when managing an agent the caller does not own", async () => {
    const app = appAs(USER);
    const response = await post(app, "/OTHERBOT/tokens", { label: "nope" });
    expect(response.status).toBe(404);
  });

  it("lists, revokes, and rotates owned tokens", async () => {
    const app = appAs(USER);
    const createdResponse = await post(app, "/RANKBOT/tokens", { label: "k" });
    const created: any = await createdResponse.json();
    const id = created.record.id;

    const listResponse = await app.request("/RANKBOT/tokens");
    const list: any = await listResponse.json();
    expect(list.tokens).toHaveLength(1);
    expect(list.tokens[0]).not.toHaveProperty("token_hash");

    const revoked = await post(app, `/RANKBOT/tokens/${id}/revoke`);
    expect(revoked.status).toBe(200);
    const revokedJson: any = await revoked.json();
    expect(revokedJson.record.status).toBe("revoked");

    const freshResponse = await post(app, "/RANKBOT/tokens", { label: "live" });
    const fresh: any = await freshResponse.json();
    const rotate = await post(app, `/RANKBOT/tokens/${fresh.record.id}/rotate`);
    expect(rotate.status).toBe(201);
    const rotateJson: any = await rotate.json();
    expect(rotateJson.token).toMatch(/^rtbot_/);
  });

  it("returns 404 for a non-numeric token id", async () => {
    const app = appAs(USER);
    const response = await post(app, "/RANKBOT/tokens/abc/revoke");
    expect(response.status).toBe(404);
  });
});
