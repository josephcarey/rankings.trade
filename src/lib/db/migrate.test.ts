/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from "vitest";

import { type MigrationFile, runMigrations } from "./migrate";

/**
 * Mock D1Database implementation for testing
 *
 * Simulates the D1 API with an in-memory database of statements
 */
class MockD1Database {
  private data: Map<string, Map<string, unknown>> = new Map();

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
    return new MockD1Statement(sql, this.data);
  }

  withSession() {
    return this;
  }
}

/**
 * Mock D1Statement for testing
 */
class MockD1Statement {
  private bindings: unknown[] = [];

  constructor(
    private sql: string,
    private data: Map<string, Map<string, unknown>>,
  ) {}

  all(): Promise<any[]> {
    return Promise.resolve([]);
  }

  bind(...params: unknown[]) {
    this.bindings = params;
    return this;
  }

  async first<T>(): Promise<T | undefined> {
    // Simulate SELECT query
    if (this.sql.includes("SELECT") && this.sql.includes("_migrations")) {
      const table = this.data.get("_migrations");
      if (table) {
        // First binding is the name
        const migrationName = this.bindings[0];
        if (table.has(String(migrationName))) {
          return { name: migrationName } as T;
        }
      }
    }
    return undefined;
  }

  async raw(): Promise<any[][]> {
    return [];
  }

  async run() {
    // Simulate table creation
    if (this.sql.includes("CREATE TABLE")) {
      const tableName = this.parseTableName(this.sql);
      if (tableName && !this.data.has(tableName)) {
        this.data.set(tableName, new Map());
      }
    }

    // Simulate inserts into _migrations
    if (
      this.sql.includes("INSERT INTO _migrations") &&
      this.bindings.length > 0
    ) {
      const migrationsTable = this.data.get("_migrations") || new Map();
      if (!this.data.has("_migrations")) {
        this.data.set("_migrations", migrationsTable);
      }
      const migrationName = this.bindings[0];
      migrationsTable.set(String(migrationName), { name: migrationName });
    }

    return { success: true };
  }

  private parseTableName(sql: string): string | null {
    const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
    if (match?.[1]) return match[1];
    const match2 = sql.match(/CREATE TABLE (\w+)/i);
    if (match2?.[1]) return match2[1];
    return null;
  }
}

describe("runMigrations", () => {
  let db: any;

  beforeEach(() => {
    db = new MockD1Database() as unknown as D1Database;
  });

  it("creates the _migrations table on first run", async () => {
    const migrations: MigrationFile[] = [];
    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual([]);
  });

  it("applies a single migration", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_init",
        content: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
      },
    ];

    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["0001_init"]);
  });

  it("applies multiple migrations in order", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_init",
        content: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      },
      {
        name: "0002_add_posts",
        content:
          "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER);",
      },
      {
        name: "0003_add_index",
        content: "CREATE INDEX idx_posts_user_id ON posts(user_id);",
      },
    ];

    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual([
      "0001_init",
      "0002_add_posts",
      "0003_add_index",
    ]);
  });

  it("is idempotent: skips already-applied migrations", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_init",
        content: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      },
      {
        name: "0002_add_posts",
        content: "CREATE TABLE posts (id INTEGER PRIMARY KEY);",
      },
    ];

    // First run: apply both
    const result1 = await runMigrations(db, migrations);
    expect(result1.applied).toEqual(["0001_init", "0002_add_posts"]);

    // Second run: should skip both (already applied)
    const result2 = await runMigrations(db, migrations);
    expect(result2.applied).toEqual([]);
  });

  it("handles migrations with multiple SQL statements", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_multi",
        content: `
          CREATE TABLE users (id INTEGER PRIMARY KEY);
          CREATE TABLE posts (id INTEGER PRIMARY KEY);
          CREATE INDEX idx_posts ON posts(id);
        `,
      },
    ];

    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["0001_multi"]);
  });

  it("handles migrations with leading/trailing whitespace and comments", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_clean",
        content: `
          -- This is a comment
          CREATE TABLE users (id INTEGER PRIMARY KEY);
          
          -- Another comment
          CREATE TABLE posts (id INTEGER PRIMARY KEY);
        `,
      },
    ];

    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["0001_clean"]);
  });

  it("supports partial runs when some migrations are already applied", async () => {
    const migrations1: MigrationFile[] = [
      {
        name: "0001_init",
        content: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      },
    ];

    const migrations2: MigrationFile[] = [
      {
        name: "0001_init",
        content: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      },
      {
        name: "0002_add_posts",
        content: "CREATE TABLE posts (id INTEGER PRIMARY KEY);",
      },
    ];

    // Run first migration
    const result1 = await runMigrations(db, migrations1);
    expect(result1.applied).toEqual(["0001_init"]);

    // Run both, should only apply the new one
    const result2 = await runMigrations(db, migrations2);
    expect(result2.applied).toEqual(["0002_add_posts"]);
  });
});
