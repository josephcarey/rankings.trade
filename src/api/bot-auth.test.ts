/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hono } from "hono";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { BotVariables } from "./bot-auth";

import { generateToken } from "../lib/agents/token";
import { insertToken, revokeToken } from "../lib/db/agent-tokens";
import { createAgent } from "../lib/db/agents";
import {
  createRequireAgentToken,
  parseBearer,
  requireAgentToken,
  shouldRefreshLastUsed,
} from "./bot-auth";

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
  prepare(sql: string) {
    return new SQLiteTestStatement(sql, this.db);
  }
}

const SCHEMA = `
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

function sqliteTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function get(app: Hono<{ Variables: BotVariables }>, auth?: string) {
  return app.request("/whoami", auth ? { headers: { Authorization: auth } } : {});
}

describe("parseBearer", () => {
  it("returns the token from a well-formed header", () => {
    expect(parseBearer("Bearer rtbot_abc")).toBe("rtbot_abc");
    expect(parseBearer("  Bearer rtbot_abc  ")).toBe("rtbot_abc");
  });

  it.each([null, undefined, "", "rtbot_abc", "Basic abc", "Bearer", "Bearer "])(
    "rejects %j",
    (header) => {
      expect(parseBearer(header as never)).toBeNull();
    },
  );
});

describe("shouldRefreshLastUsed", () => {
  const now = new Date("2026-06-12T12:00:00Z");

  it("refreshes when never used", () => {
    expect(shouldRefreshLastUsed(null, now)).toBe(true);
  });

  it("refreshes when older than the threshold", () => {
    expect(shouldRefreshLastUsed("2026-06-12 11:49:00", now)).toBe(true);
  });

  it("does not refresh when within the threshold", () => {
    expect(shouldRefreshLastUsed("2026-06-12 11:55:00", now)).toBe(false);
  });

  it("refreshes exactly at the threshold boundary", () => {
    expect(shouldRefreshLastUsed("2026-06-12 11:50:00", now)).toBe(true);
  });

  it("refreshes on an unparseable timestamp", () => {
    expect(shouldRefreshLastUsed("not-a-date", now)).toBe(true);
  });
});

describe("requireAgentToken middleware", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
    await createAgent(db, { owner_user_id: 7, symbol: "RANKBOT" });
  });

  async function seedToken() {
    const generated = await generateToken();
    const row = await insertToken(db, {
      agent_id: 1,
      label: "bot",
      owner_user_id: 7,
      token_hash: generated.hash,
      token_prefix: generated.prefix,
    });
    return { raw: generated.token, row };
  }

  function botApp(now?: () => Date) {
    const app = new Hono<{ Variables: BotVariables }>();
    app.use("*", async (context, next) => {
      context.env = { DB: db } as never;
      await next();
    });
    app.use("*", now ? createRequireAgentToken({ now }) : requireAgentToken);
    app.get("/whoami", (context) =>
      context.json({ owner: context.get("agent").owner_user_id, symbol: context.get("agent").symbol }),
    );
    return app;
  }

  it("rejects a request with no Authorization header (401)", async () => {
    const response = await get(botApp());
    expect(response.status).toBe(401);
    expect(((await response.json()) as any).error.code).toBe("unauthorized");
  });

  it("rejects a malformed Authorization header (401)", async () => {
    const response = await get(botApp(), "Basic abc");
    expect(response.status).toBe(401);
  });

  it("rejects an unknown token (401)", async () => {
    const response = await get(botApp(), "Bearer rtbot_unknown");
    expect(response.status).toBe(401);
  });

  it("rejects a revoked token (401)", async () => {
    const { raw, row } = await seedToken();
    await revokeToken(db, row.id, 1);
    const response = await get(botApp(), `Bearer ${raw}`);
    expect(response.status).toBe(401);
  });

  it("rejects a token whose snapshot owner no longer matches the agent (401)", async () => {
    const { raw } = await seedToken();
    // Ownership moved on (e.g. an admin transfer): the token's owner snapshot (7)
    // no longer equals the agent's current owner. Fail closed even though the
    // token row itself is not revoked.
    await db
      .prepare("UPDATE agents SET owner_user_id = ? WHERE id = ?")
      .bind(8, 1)
      .run();
    const response = await get(botApp(), `Bearer ${raw}`);
    expect(response.status).toBe(401);
  });

  it("rejects a token after its agent is released to unowned (401)", async () => {
    const { raw } = await seedToken();
    await db.prepare("UPDATE agents SET owner_user_id = NULL WHERE id = ?").bind(1).run();
    const response = await get(botApp(), `Bearer ${raw}`);
    expect(response.status).toBe(401);
  });

  it("accepts a valid token and exposes the agent to handlers", async () => {
    const { raw } = await seedToken();
    const response = await get(botApp(), `Bearer ${raw}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ owner: 7, symbol: "RANKBOT" });
  });

  it("stamps last_used_at on first use, then throttles a recent token", async () => {
    const { raw, row } = await seedToken();

    // Recently used (1 minute ago) → within throttle window → no rewrite.
    const recent = sqliteTime(new Date(Date.now() - 60 * 1000));
    await db
      .prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?")
      .bind(recent, row.id)
      .run();
    await get(botApp(), `Bearer ${raw}`);
    const afterRecent = await db
      .prepare("SELECT last_used_at AS t FROM agent_tokens WHERE id = ?")
      .bind(row.id)
      .first<{ t: string }>();
    expect(afterRecent?.t).toBe(recent);
  });

  it("rewrites last_used_at when the stored value is stale", async () => {
    const { raw, row } = await seedToken();

    const stale = sqliteTime(new Date(Date.now() - 30 * 60 * 1000));
    await db
      .prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?")
      .bind(stale, row.id)
      .run();
    await get(botApp(), `Bearer ${raw}`);
    const after = await db
      .prepare("SELECT last_used_at AS t FROM agent_tokens WHERE id = ?")
      .bind(row.id)
      .first<{ t: string }>();
    expect(after?.t).not.toBe(stale);
  });
});
