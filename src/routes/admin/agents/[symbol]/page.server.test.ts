/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent } from "../../../../lib/db/agents";
import { provisionUser } from "../../../../lib/db/users";
import { actions, load } from "./+page.server";

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

function formRequest(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://app.test/admin/agents/RANKBOT", { body, method: "POST" });
}

describe("admin transfer page server", () => {
  let db: D1Database;
  let aliceId: number;
  let adminId: number;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
    await provisionUser(db, { clerk_user_id: "user_admin", display_name: "Admin", email: null, email_verified: false });
    await provisionUser(db, { clerk_user_id: "user_alice", display_name: "Alice", email: null, email_verified: false });
    await provisionUser(db, { clerk_user_id: "user_bob", display_name: "Bob", email: null, email_verified: false });
    adminId = await userId(db, "user_admin");
    aliceId = await userId(db, "user_alice");
    await createAgent(db, { owner_user_id: aliceId, symbol: "RANKBOT" });
  });

  function ctx(extra: Record<string, unknown> = {}, clerkUserId: string | null = "user_admin") {
    return {
      locals: { user: { id: adminId }, userId: clerkUserId },
      params: { symbol: "RANKBOT" },
      platform: { env: { ADMIN_CLERK_USER_IDS: ADMIN_ENV, DB: db } },
      ...extra,
    } as never;
  }

  const transfer = actions.transfer as NonNullable<typeof actions.transfer>;

  describe("load", () => {
    it("returns the agent for an admin", async () => {
      const result: any = await load(ctx());
      expect(result.agent.symbol).toBe("RANKBOT");
    });

    it("returns 404 for a non-admin", async () => {
      await expect(load(ctx({}, "user_alice"))).rejects.toMatchObject({ status: 404 });
    });

    it("returns 404 for an unknown agent", async () => {
      await expect(load(ctx({ params: { symbol: "NOSUCH" } }))).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("transfer action", () => {
    it("transfers ownership for an admin", async () => {
      const result: any = await transfer(
        ctx({ request: formRequest({ newOwnerClerkId: "user_bob", reason: "dispute" }) }),
      );
      const bobId = await userId(db, "user_bob");
      expect(result.transferred.newOwnerUserId).toBe(bobId);
      expect(result.transferred.revokedTokens).toBe(0);
    });

    it("returns 403 for a non-admin", async () => {
      await expect(
        transfer(
          ctx({ request: formRequest({ newOwnerClerkId: "user_bob" }) }, "user_alice"),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("fails with 400 when transferring to the current owner", async () => {
      const result: any = await transfer(
        ctx({ request: formRequest({ newOwnerClerkId: "user_alice" }) }),
      );
      expect(result.status).toBe(400);
      expect(result.data.error).toBeTruthy();
    });

    it("fails with 400 for an unknown target user", async () => {
      const result: any = await transfer(
        ctx({ request: formRequest({ newOwnerClerkId: "user_ghost" }) }),
      );
      expect(result.status).toBe(400);
    });
  });
});
