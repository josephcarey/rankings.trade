/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getUserByClerkId,
  provisionUser,
  updateUserProfile,
  upsertUser,
  type Visibility,
} from "./users";

// ---------------------------------------------------------------------------
// In-memory SQLite adapter (mirrors the one in migrate.test.ts)
// ---------------------------------------------------------------------------

class SQLiteTestStatement {
  private bindings: unknown[] = [];

  constructor(
    private sql: string,
    private db: any,
  ) {}

  async all<T>(): Promise<T[]> {
    try {
      const results = this.db.exec(this.sql, this.bindings);
      if (results.length === 0 || !results[0]) return [];
      const columns = results[0].columns as string[];
      return (results[0].values as unknown[][]).map((values) => {
        const row: Record<string, unknown> = {};
        for (const [index, col] of columns.entries()) {
          row[col] = values[index];
        }
        return row as T;
      });
    } catch {
      return [];
    }
  }

  bind(...params: unknown[]) {
    this.bindings = params;
    return this;
  }

  async first<T>(): Promise<T | undefined> {
    try {
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
    } catch {
      return undefined;
    }
  }

  async raw(): Promise<any[][]> {
    return [];
  }

  async run() {
    try {
      this.db.run(this.sql, this.bindings);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SQL execution failed: ${message}`, { cause: error });
    }
  }
}

class SQLiteTestDatabase {
  constructor(private db: any) {}

  all() {
    return Promise.resolve([]);
  }
  batch() {
    return Promise.resolve([]);
  }
  dump() {
    return Promise.resolve(new ArrayBuffer(0));
  }
  exec() {
    return Promise.resolve({ success: true });
  }
  prepare(sql: string) {
    return new SQLiteTestStatement(sql, this.db);
  }
  withSession() {
    return this;
  }
}

// ---------------------------------------------------------------------------
// Schema used in tests — mirrors migrations/0002_users.sql exactly
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getUserByClerkId", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(USERS_SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
  });

  it("returns null when no user exists", async () => {
    const result = await getUserByClerkId(db, "user_nonexistent");
    expect(result).toBeNull();
  });

  it("returns the user record when it exists", async () => {
    await upsertUser(db, { clerk_user_id: "user_abc", email: "a@b.com" });
    const user = await getUserByClerkId(db, "user_abc");
    expect(user).not.toBeNull();
    expect(user?.clerk_user_id).toBe("user_abc");
    expect(user?.email).toBe("a@b.com");
  });

  it("exposes the visibility field so Epic J can filter on it", async () => {
    await upsertUser(db, { clerk_user_id: "user_abc", visibility: "private" });
    const user = await getUserByClerkId(db, "user_abc");
    expect(user?.visibility).toBe("private");
  });

  it("returns null for a different clerk_user_id", async () => {
    await upsertUser(db, { clerk_user_id: "user_abc" });
    const result = await getUserByClerkId(db, "user_xyz");
    expect(result).toBeNull();
  });
});

describe("upsertUser", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(USERS_SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
  });

  it("creates a new user with all provided fields", async () => {
    const user = await upsertUser(db, {
      clerk_user_id: "user_1",
      email: "user@example.com",
      display_name: "Alice",
      visibility: "private",
      dashboard_url: "https://example.com/dash",
    });
    expect(user.clerk_user_id).toBe("user_1");
    expect(user.email).toBe("user@example.com");
    expect(user.display_name).toBe("Alice");
    expect(user.visibility).toBe("private");
    expect(user.dashboard_url).toBe("https://example.com/dash");
  });

  it("defaults visibility to 'public' when not provided", async () => {
    const user = await upsertUser(db, { clerk_user_id: "user_1" });
    expect(user.visibility).toBe("public");
  });

  it("defaults nullable fields to null when not provided", async () => {
    const user = await upsertUser(db, { clerk_user_id: "user_1" });
    expect(user.email).toBeNull();
    expect(user.display_name).toBeNull();
    expect(user.dashboard_url).toBeNull();
  });

  it("updates an existing user on a second call (idempotent write)", async () => {
    await upsertUser(db, { clerk_user_id: "user_1", email: "old@example.com" });
    const updated = await upsertUser(db, {
      clerk_user_id: "user_1",
      email: "new@example.com",
    });
    expect(updated.email).toBe("new@example.com");
  });

  it("does not create duplicate records on repeated upserts", async () => {
    await upsertUser(db, { clerk_user_id: "user_1" });
    await upsertUser(db, { clerk_user_id: "user_1" });

    // Verify only one record exists via a direct raw INSERT failure
    await expect(
      db
        .prepare("INSERT INTO users (clerk_user_id) VALUES (?)")
        .bind("user_1")
        .run(),
    ).rejects.toThrow();
  });

  it("enforces the clerk_user_id UNIQUE constraint on direct INSERT", async () => {
    await db
      .prepare("INSERT INTO users (clerk_user_id) VALUES (?)")
      .bind("user_dup")
      .run();
    await expect(
      db
        .prepare("INSERT INTO users (clerk_user_id) VALUES (?)")
        .bind("user_dup")
        .run(),
    ).rejects.toThrow();
  });

  it("enforces the visibility CHECK constraint", async () => {
    await expect(
      upsertUser(db, {
        clerk_user_id: "user_1",
        visibility: "invalid" as Visibility,
      }),
    ).rejects.toThrow();
  });

  it("enforces the dashboard_url length CHECK constraint (> 2048 chars)", async () => {
    const tooLong = "https://" + "a".repeat(2048);
    await expect(
      upsertUser(db, { clerk_user_id: "user_1", dashboard_url: tooLong }),
    ).rejects.toThrow();
  });

  it("accepts a dashboard_url of exactly 2048 characters", async () => {
    const exactly2048 = "https://" + "a".repeat(2040);
    const user = await upsertUser(db, {
      clerk_user_id: "user_1",
      dashboard_url: exactly2048,
    });
    expect(user.dashboard_url).toBe(exactly2048);
  });

  it("populates created_at and updated_at timestamps", async () => {
    const user = await upsertUser(db, { clerk_user_id: "user_1" });
    expect(user.created_at).toBeTruthy();
    expect(user.updated_at).toBeTruthy();
  });
});

describe("updateUserProfile", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(USERS_SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
  });

  it("returns null when the user does not exist", async () => {
    const result = await updateUserProfile(db, "user_missing", {
      display_name: "Ghost",
    });
    expect(result).toBeNull();
  });

  it("updates display_name", async () => {
    await upsertUser(db, { clerk_user_id: "user_1" });
    const updated = await updateUserProfile(db, "user_1", {
      display_name: "New Name",
    });
    expect(updated?.display_name).toBe("New Name");
  });

  it("updates visibility", async () => {
    await upsertUser(db, { clerk_user_id: "user_1", visibility: "public" });
    const updated = await updateUserProfile(db, "user_1", {
      visibility: "private",
    });
    expect(updated?.visibility).toBe("private");
  });

  it("updates dashboard_url", async () => {
    await upsertUser(db, { clerk_user_id: "user_1" });
    const updated = await updateUserProfile(db, "user_1", {
      dashboard_url: "https://my.dashboard.io",
    });
    expect(updated?.dashboard_url).toBe("https://my.dashboard.io");
  });

  it("sets dashboard_url to null explicitly", async () => {
    await upsertUser(db, {
      clerk_user_id: "user_1",
      dashboard_url: "https://old.url",
    });
    const updated = await updateUserProfile(db, "user_1", {
      dashboard_url: null,
    });
    expect(updated?.dashboard_url).toBeNull();
  });

  it("leaves unspecified fields unchanged", async () => {
    await upsertUser(db, {
      clerk_user_id: "user_1",
      display_name: "Original",
      visibility: "private",
    });
    const updated = await updateUserProfile(db, "user_1", {
      display_name: "Changed",
    });
    // visibility was not in the update input — must stay 'private'
    expect(updated?.visibility).toBe("private");
    expect(updated?.display_name).toBe("Changed");
  });

  it("leaves all fields unchanged when input is empty", async () => {
    await upsertUser(db, {
      clerk_user_id: "user_1",
      display_name: "Stable",
      visibility: "private",
    });
    const updated = await updateUserProfile(db, "user_1", {});
    expect(updated?.display_name).toBe("Stable");
    expect(updated?.visibility).toBe("private");
  });

  it("enforces the visibility CHECK constraint on update", async () => {
    await upsertUser(db, { clerk_user_id: "user_1" });
    await expect(
      updateUserProfile(db, "user_1", { visibility: "bad" as Visibility }),
    ).rejects.toThrow();
  });

  it("enforces the dashboard_url length CHECK on update", async () => {
    await upsertUser(db, { clerk_user_id: "user_1" });
    const tooLong = "https://" + "b".repeat(2048);
    await expect(
      updateUserProfile(db, "user_1", { dashboard_url: tooLong }),
    ).rejects.toThrow();
  });
});

describe("provisionUser", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    const sqliteDb = new SQL.Database();
    sqliteDb.run(USERS_SCHEMA);
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
  });

  it("creates a new row with the schema defaults for local-only fields", async () => {
    const user = await provisionUser(db, {
      clerk_user_id: "user_new",
      display_name: "Ada Lovelace",
      email: "ada@example.com",
    });

    expect(user.clerk_user_id).toBe("user_new");
    expect(user.email).toBe("ada@example.com");
    expect(user.display_name).toBe("Ada Lovelace");
    expect(user.visibility).toBe("public");
    expect(user.dashboard_url).toBeNull();
  });

  it("is idempotent on repeat provisioning", async () => {
    const first = await provisionUser(db, {
      clerk_user_id: "user_1",
      display_name: "Ada",
      email: "ada@example.com",
    });
    const second = await provisionUser(db, {
      clerk_user_id: "user_1",
      display_name: "Ada",
      email: "ada@example.com",
    });

    expect(second.id).toBe(first.id);
  });

  it("refreshes Clerk fields while preserving local-only fields", async () => {
    await provisionUser(db, {
      clerk_user_id: "user_1",
      display_name: "Old Name",
      email: "old@example.com",
    });
    // The user later sets local-only fields via the profile settings flow.
    await updateUserProfile(db, "user_1", {
      dashboard_url: "https://dash.example.com",
      visibility: "private",
    });

    // A later authenticated request re-provisions with changed Clerk fields.
    const refreshed = await provisionUser(db, {
      clerk_user_id: "user_1",
      display_name: "New Name",
      email: "new@example.com",
    });

    expect(refreshed.email).toBe("new@example.com");
    expect(refreshed.display_name).toBe("New Name");
    expect(refreshed.visibility).toBe("private");
    expect(refreshed.dashboard_url).toBe("https://dash.example.com");
  });

  it("stores null Clerk fields without binding undefined", async () => {
    const user = await provisionUser(db, {
      clerk_user_id: "user_anon",
      display_name: null,
      email: null,
    });

    expect(user.email).toBeNull();
    expect(user.display_name).toBeNull();
  });

  it("re-links an existing email to a new Clerk id instead of duplicating", async () => {
    const original = await provisionUser(db, {
      clerk_user_id: "clerk_old",
      display_name: "Joe",
      email: "joe@example.com",
    });
    await updateUserProfile(db, "clerk_old", {
      dashboard_url: "https://dash.example.com",
      visibility: "private",
    });

    // Same email re-authenticates under a brand-new Clerk id.
    const relinked = await provisionUser(db, {
      clerk_user_id: "clerk_new",
      display_name: "Joseph",
      email: "joe@example.com",
    });

    // Same row, re-pointed to the new Clerk id — no duplicate created.
    expect(relinked.id).toBe(original.id);
    expect(relinked.clerk_user_id).toBe("clerk_new");
    expect(relinked.display_name).toBe("Joseph");
    // Local-only fields preserved across the re-link.
    expect(relinked.visibility).toBe("private");
    expect(relinked.dashboard_url).toBe("https://dash.example.com");

    const all = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(all?.n).toBe(1);
    // The old Clerk id no longer resolves a row.
    expect(await getUserByClerkId(db, "clerk_old")).toBeNull();
  });

  it("does not re-link when email is null (creates a separate row)", async () => {
    await provisionUser(db, {
      clerk_user_id: "clerk_a",
      display_name: "A",
      email: null,
    });
    await provisionUser(db, {
      clerk_user_id: "clerk_b",
      display_name: "B",
      email: null,
    });

    const all = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(all?.n).toBe(2);
  });
});
