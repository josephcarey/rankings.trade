/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { getUserByClerkId, provisionUser } from "../../lib/db/users";
import { actions, load } from "./+page.server";

// ---------------------------------------------------------------------------
// Minimal in-memory D1 adapter (mirrors users.test.ts / local-user.test.ts).
// ---------------------------------------------------------------------------

class SQLiteTestStatement {
  private bindings: unknown[] = [];

  constructor(
    private sql: string,
    private db: any,
  ) {}

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
      for (const [index, col] of columns.entries()) {
        row[col] = values[index];
      }
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

const USERS_SCHEMA = `
  CREATE TABLE users (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    clerk_user_id TEXT     NOT NULL UNIQUE,
    email         TEXT     NULL,
    display_name  TEXT     NULL,
    visibility    TEXT     NOT NULL DEFAULT 'public'
                           CHECK (visibility IN ('public', 'private')),
    dashboard_url TEXT     NULL
                           CHECK (dashboard_url IS NULL OR LENGTH(dashboard_url) <= 2048),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

const CLERK_USER_ID = "user_1";

function formRequest(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.set(key, value);
  }
  return new Request("https://app.test/settings", { body, method: "POST" });
}

describe("settings profile server", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(USERS_SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
    await provisionUser(db, {
      clerk_user_id: CLERK_USER_ID,
      display_name: "Ada",
      email: "ada@example.com",
    });
  });

  describe("load", () => {
    it("seeds the form with the current user's visibility and dashboard url", async () => {
      const user = await getUserByClerkId(db, CLERK_USER_ID);
      const result = (await load({ locals: { user } } as never)) as {
        form: { data: unknown };
      };

      expect(result.form.data).toEqual({
        dashboard_url: "",
        visibility: "public",
      });
    });

    it("redirects when there is no resolved local user", async () => {
      await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject(
        { location: "/sign-in", status: 302 },
      );
    });
  });

  describe("action", () => {
    const runAction = actions.default as NonNullable<typeof actions.default>;

    function invoke(fields: Record<string, string>) {
      return runAction({
        locals: { userId: CLERK_USER_ID },
        platform: { env: { DB: db } },
        request: formRequest(fields),
      } as never);
    }

    it("persists valid input and returns a success message", async () => {
      const result: any = await invoke({
        dashboard_url: "https://dash.example.com",
        visibility: "private",
      });

      expect(result.form.valid).toBe(true);
      expect(result.form.message).toBe("Profile updated.");

      const row = await getUserByClerkId(db, CLERK_USER_ID);
      expect(row?.visibility).toBe("private");
      expect(row?.dashboard_url).toBe("https://dash.example.com");
    });

    it("trims the dashboard url before persisting", async () => {
      await invoke({
        dashboard_url: "  https://dash.example.com  ",
        visibility: "public",
      });

      const row = await getUserByClerkId(db, CLERK_USER_ID);
      expect(row?.dashboard_url).toBe("https://dash.example.com");
    });

    it("clears the dashboard url when submitted empty", async () => {
      await invoke({ dashboard_url: "https://dash.example.com", visibility: "public" });
      await invoke({ dashboard_url: "", visibility: "public" });

      const row = await getUserByClerkId(db, CLERK_USER_ID);
      expect(row?.dashboard_url).toBeNull();
    });

    it("rejects an invalid url with a field error and does not persist", async () => {
      const result: any = await invoke({
        dashboard_url: "not-a-url",
        visibility: "public",
      });

      expect(result.status).toBe(400);
      expect(result.data.form.valid).toBe(false);
      expect(result.data.form.errors.dashboard_url).toBeTruthy();

      const row = await getUserByClerkId(db, CLERK_USER_ID);
      expect(row?.dashboard_url).toBeNull();
    });

    it("fails without persisting when the user row is missing", async () => {
      const result: any = await runAction({
        locals: { userId: "user_absent" },
        platform: { env: { DB: db } },
        request: formRequest({
          dashboard_url: "https://dash.example.com",
          visibility: "private",
        }),
      } as never);

      expect(result.status).toBe(404);
      expect(result.data.form.valid).toBe(true);
    });
  });
});
