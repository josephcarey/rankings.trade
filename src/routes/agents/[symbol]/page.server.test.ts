/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent } from "../../../lib/db/agents";
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

const OWNER = { id: 7 };

function formRequest(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://app.test/agents/RANKBOT", { body, method: "POST" });
}

describe("agent token page server", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
    await createAgent(db, { owner_user_id: 7, symbol: "RANKBOT" });
    await createAgent(db, { owner_user_id: 99, symbol: "OTHERBOT" });
  });

  function ctx(extra: Record<string, unknown> = {}, user: unknown = OWNER) {
    return {
      locals: { user },
      params: { symbol: "RANKBOT" },
      platform: { env: { DB: db } },
      ...extra,
    } as never;
  }

  const create = actions.create as NonNullable<typeof actions.create>;
  const revoke = actions.revoke as NonNullable<typeof actions.revoke>;
  const rotate = actions.rotate as NonNullable<typeof actions.rotate>;

  describe("load", () => {
    it("returns the agent and its tokens for the owner", async () => {
      const result: any = await load(ctx());
      expect(result.agent.symbol).toBe("RANKBOT");
      expect(result.tokens).toEqual([]);
    });

    it("returns 404 for a callsign the caller does not own", async () => {
      await expect(
        load(ctx({ params: { symbol: "OTHERBOT" } })),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("create action", () => {
    it("issues a token and surfaces the raw secret once", async () => {
      const result: any = await create(ctx({ request: formRequest({ label: "CI" }) }));
      expect(result.secret).toMatch(/^rtbot_/);
      expect(result.created.label).toBe("CI");

      const list: any = await load(ctx());
      expect(list.tokens).toHaveLength(1);
      // The reloaded list never carries the secret.
      expect(list.tokens[0]).not.toHaveProperty("token_hash");
    });

    it("fails with 400 on an invalid label", async () => {
      const result: any = await create(ctx({ request: formRequest({ label: "" }) }));
      expect(result.status).toBe(400);
      expect(result.data.error).toBeTruthy();
    });

    it("returns 404 when creating on a non-owned agent", async () => {
      await expect(
        create(ctx({ params: { symbol: "OTHERBOT" }, request: formRequest({ label: "x" }) })),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("revoke and rotate actions", () => {
    it("revokes an owned token", async () => {
      const seeded: any = await create(ctx({ request: formRequest({ label: "k" }) }));
      const id = seeded.created.id as number;
      const result: any = await revoke(ctx({ request: formRequest({ tokenId: String(id) }) }));
      expect(result.revoked.status).toBe("revoked");
    });

    it("rotates an owned token and shows the new secret once", async () => {
      const seeded: any = await create(ctx({ request: formRequest({ label: "k" }) }));
      const id = seeded.created.id as number;
      const result: any = await rotate(ctx({ request: formRequest({ tokenId: String(id) }) }));
      expect(result.secret).toMatch(/^rtbot_/);
      expect(result.rotated.id).not.toBe(id);
    });

    it("returns 404 for a non-numeric token id", async () => {
      await expect(
        revoke(ctx({ request: formRequest({ tokenId: "abc" }) })),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("returns 404 when rotating a token that does not exist", async () => {
      await expect(
        rotate(ctx({ request: formRequest({ tokenId: "999999" }) })),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
