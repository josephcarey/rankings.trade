/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent } from "../db/agents";
import {
  createAgentToken,
  listAgentTokens,
  parseTokenId,
  revokeAgentToken,
  rotateAgentToken,
} from "./token-service";

// ---------------------------------------------------------------------------
// In-memory SQLite adapter (`all` returns the D1 `{ results }` shape).
// ---------------------------------------------------------------------------

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

const OWNER = 7;
const OTHER = 99;

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const sqliteDb = new SQL.Database();
  sqliteDb.run(SCHEMA);
  const db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
  await createAgent(db, { owner_user_id: OWNER, symbol: "RANKBOT" });
  await createAgent(db, { owner_user_id: OTHER, symbol: "OTHERBOT" });
  return db;
}

describe("parseTokenId", () => {
  it("accepts positive integers", () => {
    expect(parseTokenId("1")).toBe(1);
    expect(parseTokenId("42")).toBe(42);
  });

  it.each(["abc", "1.2", "-1", "0", "", " 1", "1 ", "9007199254740993"])(
    "rejects %j",
    (raw) => {
      expect(parseTokenId(raw)).toBeNull();
    },
  );
});

describe("token-service ownership", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await makeDb();
  });

  it.each([
    ["list", (d: D1Database) => listAgentTokens(d, "RANKBOT", OTHER)],
    ["create", (d: D1Database) => createAgentToken(d, "RANKBOT", OTHER, "x")],
    ["revoke", (d: D1Database) => revokeAgentToken(d, "RANKBOT", OTHER, 1)],
    ["rotate", (d: D1Database) => rotateAgentToken(d, "RANKBOT", OTHER, 1)],
  ])("denies %s to a non-owner as not_found", async (_name, op) => {
    const result = await op(db);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("denies operations on an unknown callsign as not_found", async () => {
    const result = await listAgentTokens(db, "NOSUCH", OWNER);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("normalizes the callsign before the ownership lookup", async () => {
    const result = await listAgentTokens(db, "  rankbot  ", OWNER);
    expect(result.ok).toBe(true);
  });
});

describe("createAgentToken", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await makeDb();
  });

  it("issues a token, returns the raw secret once, and stores only the trimmed label", async () => {
    const result = await createAgentToken(db, "RANKBOT", OWNER, "  CI deploy  ");
    if (!result.ok) throw new Error("expected ok");

    expect(result.value.token).toMatch(/^rtbot_/);
    expect(result.value.view.label).toBe("CI deploy");
    expect(result.value.view.status).toBe("active");
    expect(result.value.view.last_used_at).toBeNull();
    expect(result.value.view.token_prefix.startsWith("rtbot_")).toBe(true);
    // The view must never carry the secret hash.
    expect(result.value.view).not.toHaveProperty("token_hash");
  });

  it.each(["", ' '.repeat(3), "a".repeat(61)])(
    "rejects an invalid label %j without writing",
    async (label) => {
      const result = await createAgentToken(db, "RANKBOT", OWNER, label);
      expect(result).toEqual({ ok: false, reason: "invalid_label" });

      const list = await listAgentTokens(db, "RANKBOT", OWNER);
      if (!list.ok) throw new Error("expected ok");
      expect(list.value).toHaveLength(0);
    },
  );
});

describe("listAgentTokens", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await makeDb();
  });

  it("returns non-secret views for active and revoked tokens, newest first", async () => {
    const first = await createAgentToken(db, "RANKBOT", OWNER, "first");
    await createAgentToken(db, "RANKBOT", OWNER, "second");
    if (!first.ok) throw new Error("expected ok");
    await revokeAgentToken(db, "RANKBOT", OWNER, first.value.view.id);

    const list = await listAgentTokens(db, "RANKBOT", OWNER);
    if (!list.ok) throw new Error("expected ok");

    expect(list.value.map((t) => t.label)).toEqual(["second", "first"]);
    const revoked = list.value.find((t) => t.label === "first");
    expect(revoked?.status).toBe("revoked");
    for (const view of list.value) {
      expect(view).not.toHaveProperty("token_hash");
    }
  });
});

describe("revokeAgentToken", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await makeDb();
  });

  it("revokes an owned token and is idempotent on re-revoke", async () => {
    const created = await createAgentToken(db, "RANKBOT", OWNER, "kill me");
    if (!created.ok) throw new Error("expected ok");
    const id = created.value.view.id;

    const first = await revokeAgentToken(db, "RANKBOT", OWNER, id);
    if (!first.ok) throw new Error("expected ok");
    expect(first.value.status).toBe("revoked");

    // Re-revoking is idempotent: still revoked, original revoked_at unchanged.
    const second = await revokeAgentToken(db, "RANKBOT", OWNER, id);
    if (!second.ok) throw new Error("expected ok");
    expect(second.value.status).toBe("revoked");
  });

  it("does not revoke a token belonging to another agent", async () => {
    const otherToken = await createAgentToken(db, "OTHERBOT", OTHER, "theirs");
    if (!otherToken.ok) throw new Error("expected ok");

    const result = await revokeAgentToken(db, "RANKBOT", OWNER, otherToken.value.view.id);
    expect(result).toEqual({ ok: false, reason: "not_found" });

    const otherList = await listAgentTokens(db, "OTHERBOT", OTHER);
    if (!otherList.ok) throw new Error("expected ok");
    expect(otherList.value[0]?.status).toBe("active");
  });
});

describe("rotateAgentToken", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await makeDb();
  });

  it("revokes the old token and issues one replacement with the same label", async () => {
    const created = await createAgentToken(db, "RANKBOT", OWNER, "rotate me");
    if (!created.ok) throw new Error("expected ok");
    const oldId = created.value.view.id;

    const rotated = await rotateAgentToken(db, "RANKBOT", OWNER, oldId);
    if (!rotated.ok) throw new Error("expected ok");

    expect(rotated.value.token).toMatch(/^rtbot_/);
    expect(rotated.value.token).not.toBe(created.value.token);
    expect(rotated.value.view.label).toBe("rotate me");
    expect(rotated.value.view.id).not.toBe(oldId);

    const list = await listAgentTokens(db, "RANKBOT", OWNER);
    if (!list.ok) throw new Error("expected ok");
    const old = list.value.find((t) => t.id === oldId);
    expect(old?.status).toBe("revoked");
    const fresh = list.value.find((t) => t.id === rotated.value.view.id);
    expect(fresh?.status).toBe("active");
  });

  it("returns not_found when rotating a revoked or unknown token", async () => {
    const created = await createAgentToken(db, "RANKBOT", OWNER, "once");
    if (!created.ok) throw new Error("expected ok");
    await revokeAgentToken(db, "RANKBOT", OWNER, created.value.view.id);

    const onRevoked = await rotateAgentToken(db, "RANKBOT", OWNER, created.value.view.id);
    expect(onRevoked).toEqual({ ok: false, reason: "not_found" });

    const onUnknown = await rotateAgentToken(db, "RANKBOT", OWNER, 999_999);
    expect(onUnknown).toEqual({ ok: false, reason: "not_found" });
  });
});
