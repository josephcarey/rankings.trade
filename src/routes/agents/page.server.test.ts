/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent, getAgentBySymbol } from "../../lib/db/agents";
import { actions, load } from "./+page.server";

// ---------------------------------------------------------------------------
// In-memory D1 adapter (`all` returns the D1 `{ results }` shape).
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
    symbol        TEXT     NOT NULL UNIQUE
                           CHECK (symbol = UPPER(symbol) AND LENGTH(symbol) BETWEEN 3 AND 20),
    display_name  TEXT     NULL,
    owner_user_id INTEGER  NULL,
    verified      INTEGER  NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

const USER = { id: 7 };

function formRequest(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://app.test/agents", { body, method: "POST" });
}

describe("agents page server", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
  });

  describe("load", () => {
    it("returns an empty form and the caller's owned agents", async () => {
      await createAgent(db, { symbol: "MINE", owner_user_id: 7 });
      await createAgent(db, { symbol: "THEIRS", owner_user_id: 8 });

      const result = (await load({
        locals: { user: USER },
        platform: { env: { DB: db } },
      } as never)) as { form: { data: unknown }; agents: { symbol: string }[] };

      expect(result.form.data).toEqual({ symbol: "" });
      expect(result.agents.map((a) => a.symbol)).toEqual(["MINE"]);
    });

    it("redirects when there is no resolved local user", async () => {
      await expect(
        load({ locals: { user: null }, platform: { env: { DB: db } } } as never),
      ).rejects.toMatchObject({ location: "/sign-in", status: 302 });
    });
  });

  describe("action", () => {
    const runAction = actions.default as NonNullable<typeof actions.default>;

    function invoke(fields: Record<string, string>, user: unknown = USER) {
      return runAction({
        locals: { user },
        platform: { env: { DB: db } },
        request: formRequest(fields),
      } as never);
    }

    it("claims an unowned callsign and reports it as unverified", async () => {
      const result: any = await invoke({ symbol: "rankbot" });

      expect(result.form.valid).toBe(true);
      expect(result.form.message).toMatch(/Claimed RANKBOT/);
      expect(result.form.message).toMatch(/unverified/i);

      const agent = await getAgentBySymbol(db, "RANKBOT");
      expect(agent?.owner_user_id).toBe(7);
      expect(agent?.verified).toBe(0);
    });

    it("treats a re-claim by the same owner as already owned", async () => {
      await invoke({ symbol: "DUP" });
      const result: any = await invoke({ symbol: "DUP" });
      expect(result.form.valid).toBe(true);
      expect(result.form.message).toMatch(/already own DUP/);
    });

    it("rejects a callsign already claimed by another user (409 field error)", async () => {
      await createAgent(db, { symbol: "TAKEN", owner_user_id: 99 });

      const result: any = await invoke({ symbol: "taken" });

      expect(result.status).toBe(409);
      expect(result.data.form.valid).toBe(false);
      expect(result.data.form.errors.symbol).toBeTruthy();
      const agent = await getAgentBySymbol(db, "TAKEN");
      expect(agent?.owner_user_id).toBe(99);
    });

    it("rejects an invalid symbol with a 400 before any write", async () => {
      const result: any = await invoke({ symbol: "x" });

      expect(result.status).toBe(400);
      expect(result.data.form.valid).toBe(false);
      expect(result.data.form.errors.symbol).toBeTruthy();
    });
  });
});
