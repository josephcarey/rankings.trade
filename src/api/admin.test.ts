/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { User } from "../lib/db/users";
import type { AuthedVariables } from "./auth";

import { createAgent } from "../lib/db/agents";
import { provisionUser } from "../lib/db/users";
import { transferHandler } from "./admin";

class SQLiteTestStatement {
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

class SQLiteTestDatabase {
  constructor(private db: any) {}
  async batch(statements: SQLiteTestStatement[]) {
    this.db.run("SAVEPOINT batch_sp");
    try {
      const out = [];
      for (const st of statements) out.push(await st.run());
      this.db.run("RELEASE batch_sp");
      return out;
    } catch (error) {
      this.db.run("ROLLBACK TO batch_sp");
      this.db.run("RELEASE batch_sp");
      throw error;
    }
  }
  prepare(sql: string) {
    return new SQLiteTestStatement(sql, this.db);
  }
}

const SCHEMA = `
  CREATE TABLE users (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    clerk_user_id TEXT     NOT NULL UNIQUE,
    email         TEXT     NULL,
    display_name  TEXT     NULL,
    visibility    TEXT     NOT NULL DEFAULT 'public',
    dashboard_url TEXT     NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
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
  CREATE TABLE agent_ownership_events (
    id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
    agent_id            INTEGER  NOT NULL,
    event_type          TEXT     NOT NULL,
    actor_user_id       INTEGER  NULL,
    prior_owner_user_id INTEGER  NULL,
    new_owner_user_id   INTEGER  NULL,
    reason              TEXT     NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

const ADMIN_ENV = "user_admin";

async function userId(db: D1Database, clerkId: string): Promise<number> {
  const row = await db
    .prepare("SELECT id FROM users WHERE clerk_user_id = ?")
    .bind(clerkId)
    .first<{ id: number }>();
  return row?.id as number;
}

function transferApp(db: D1Database, clerkUserId: string, actor: User) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (context, next) => {
    context.env = { ADMIN_CLERK_USER_IDS: ADMIN_ENV, DB: db } as never;
    context.set("clerkAuth", (() => ({ userId: clerkUserId })) as never);
    context.set("user", actor);
    await next();
  });
  app.post("/agents/:symbol/transfer", transferHandler as never);
  return app;
}

function post(app: Hono<{ Variables: AuthedVariables }>, url: string, body: unknown) {
  return app.request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("admin transfer endpoint", () => {
  let db: D1Database;
  let admin: User;
  let aliceId: number;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
    await provisionUser(db, { clerk_user_id: "user_admin", display_name: "Admin", email: null });
    await provisionUser(db, { clerk_user_id: "user_alice", display_name: "Alice", email: null });
    await provisionUser(db, { clerk_user_id: "user_bob", display_name: "Bob", email: null });
    aliceId = await userId(db, "user_alice");
    admin = {
      clerk_user_id: "user_admin",
      created_at: "2026-01-01",
      dashboard_url: null,
      display_name: "Admin",
      email: null,
      id: await userId(db, "user_admin"),
      updated_at: "2026-01-01",
      visibility: "public",
    };
    await createAgent(db, { owner_user_id: aliceId, symbol: "RANKBOT" });
  });

  it("returns 403 for an authed non-admin caller", async () => {
    const app = transferApp(db, "user_alice", { ...admin, clerk_user_id: "user_alice", id: aliceId });
    const response = await post(app, "/agents/RANKBOT/transfer", { newOwnerClerkId: "user_bob" });
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error.code).toBe("forbidden");
  });

  it("transfers ownership for an admin and reports the audit summary", async () => {
    const app = transferApp(db, "user_admin", admin);
    const response = await post(app, "/agents/RANKBOT/transfer", {
      newOwnerClerkId: "user_bob",
      reason: "dispute",
    });
    expect(response.status).toBe(200);
    const json: any = await response.json();
    const bobId = await userId(db, "user_bob");
    expect(json.agent.owner_user_id).toBe(bobId);
    expect(json.prior_owner_user_id).toBe(aliceId);
    expect(json.revoked_tokens).toBe(0);
  });

  it("returns 404 for an unknown agent", async () => {
    const app = transferApp(db, "user_admin", admin);
    const response = await post(app, "/agents/NOSUCH/transfer", { newOwnerClerkId: "user_bob" });
    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown target user", async () => {
    const app = transferApp(db, "user_admin", admin);
    const response = await post(app, "/agents/RANKBOT/transfer", { newOwnerClerkId: "user_ghost" });
    expect(response.status).toBe(404);
  });

  it("returns 400 when transferring to the current owner", async () => {
    const app = transferApp(db, "user_admin", admin);
    const response = await post(app, "/agents/RANKBOT/transfer", { newOwnerClerkId: "user_alice" });
    expect(response.status).toBe(400);
  });
});
