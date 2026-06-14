/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClerkUserLike } from "./clerk-identity";

import { createLocalUserHandle, resolveLocalUser } from "./local-user";

// ---------------------------------------------------------------------------
// Minimal in-memory D1 adapter (mirrors users.test.ts / migrate.test.ts).
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

const CLERK_USER: ClerkUserLike = {
  id: "user_1",
  emailAddresses: [
    {
      emailAddress: "ada@example.com",
      id: "e1",
      verification: { status: "verified" },
    },
  ],
  firstName: "Ada",
  lastName: "Lovelace",
  primaryEmailAddressId: "e1",
  username: null,
};

function makeEvent(
  locals: { userId: string | null },
  pathname: string,
  resolve = vi.fn(async () => new Response("ok")),
) {
  return {
    event: {
      locals: locals as { userId: string | null; user: unknown },
      url: new URL(`https://app.test${pathname}`),
    },
    resolve,
  } as never;
}

describe("local-user wiring", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(USERS_SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
  });

  it("resolveLocalUser provisions and returns the local user", async () => {
    const user = await resolveLocalUser(db, () => Promise.resolve(CLERK_USER));

    expect(user.clerk_user_id).toBe("user_1");
    expect(user.email).toBe("ada@example.com");
    expect(user.display_name).toBe("Ada Lovelace");
  });

  it("attaches the local user on an authed page request", async () => {
    const fetchClerkUser = vi.fn(() => Promise.resolve(CLERK_USER));
    const handle = createLocalUserHandle({ fetchClerkUser, getDb: () => db });
    const args = makeEvent({ userId: "user_1" }, "/settings");

    await handle(args);

    expect(fetchClerkUser).toHaveBeenCalledOnce();
    expect((args as any).event.locals.user.clerk_user_id).toBe("user_1");
    expect((args as any).resolve).toHaveBeenCalledOnce();
  });

  it("leaves user null and skips Clerk for a guest", async () => {
    const fetchClerkUser = vi.fn(() => Promise.resolve(CLERK_USER));
    const handle = createLocalUserHandle({ fetchClerkUser, getDb: () => db });
    const args = makeEvent({ userId: null }, "/settings");

    await handle(args);

    expect(fetchClerkUser).not.toHaveBeenCalled();
    expect((args as any).event.locals.user).toBeNull();
  });

  it("skips provisioning for API paths (Hono owns those)", async () => {
    const fetchClerkUser = vi.fn(() => Promise.resolve(CLERK_USER));
    const handle = createLocalUserHandle({ fetchClerkUser, getDb: () => db });
    const args = makeEvent({ userId: "user_1" }, "/api/me");

    await handle(args);

    expect(fetchClerkUser).not.toHaveBeenCalled();
    expect((args as any).event.locals.user).toBeNull();
  });

  it("leaves user null when the database is unavailable", async () => {
    const fetchClerkUser = vi.fn(() => Promise.resolve(CLERK_USER));
    const handle = createLocalUserHandle({
      fetchClerkUser,
      getDb: () => {},
    });
    const args = makeEvent({ userId: "user_1" }, "/settings");

    await handle(args);

    expect(fetchClerkUser).not.toHaveBeenCalled();
    expect((args as any).event.locals.user).toBeNull();
  });
});
