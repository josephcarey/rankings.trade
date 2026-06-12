/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { type MigrationFile, runMigrations } from "./migrate";

/**
 * Real SQLite database adapter wrapping sql.js for testing
 *
 * Implements the D1 API surface needed for the migration runner.
 */
class SQLiteTestDatabase {
  private db: any;

  constructor(database: any) {
    this.db = database;
  }

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

/**
 * Real SQLite statement adapter wrapping sql.js for testing
 */
class SQLiteTestStatement {
  private bindings: unknown[] = [];

  constructor(
    private sql: string,
    private db: any,
  ) {}

  all(): Promise<any[]> {
    return Promise.resolve([]);
  }

  bind(...params: unknown[]) {
    this.bindings = params;
    return this;
  }

  async first<T>(): Promise<T | undefined> {
    try {
      // For SELECT queries, use exec to run with parameters
      const results = this.db.exec(this.sql, this.bindings);
      if (results.length > 0 && results[0]?.values?.length > 0) {
        const columns = results[0].columns;
        const values = results[0].values[0];
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
      // For INSERT/CREATE/UPDATE/DELETE, use run()
      this.db.run(this.sql, this.bindings);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SQL execution failed: ${message}`, { cause: error });
    }
  }
}

describe("runMigrations", () => {
  let db: any;
  let SQL: any;

  beforeEach(async () => {
    SQL = await Database();
    const sqliteDb = new SQL.Database();
    db = new SQLiteTestDatabase(sqliteDb) as unknown as D1Database;
  });

  it("initializes successfully with no migrations", async () => {
    const migrations: MigrationFile[] = [];
    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual([]);
  });

  it("applies a single init migration that creates the _migrations table", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_init",
        content: `
          CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `,
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
        content: `
          CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `,
      },
      {
        name: "0002_add_users",
        content: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
      },
      {
        name: "0003_add_posts",
        content:
          "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER);",
      },
    ];

    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual([
      "0001_init",
      "0002_add_users",
      "0003_add_posts",
    ]);
  });

  it("is idempotent: skips already-applied migrations on second run", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_init",
        content: `
          CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `,
      },
      {
        name: "0002_add_users",
        content: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
      },
    ];

    // First run: apply both
    const result1 = await runMigrations(db, migrations);
    expect(result1.applied).toEqual(["0001_init", "0002_add_users"]);

    // Second run: should skip both (already applied)
    const result2 = await runMigrations(db, migrations);
    expect(result2.applied).toEqual([]);
  });

  it("handles migrations with multiple SQL statements", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_init",
        content: `
          CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE users (id INTEGER PRIMARY KEY);
          CREATE TABLE posts (id INTEGER PRIMARY KEY);
          CREATE INDEX idx_posts ON posts(id);
        `,
      },
    ];

    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["0001_init"]);
  });

  it("handles migrations with leading/trailing whitespace and comments", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_init",
        content: `
          -- Initialize migrations bookkeeping table
          CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );

          -- Create users table
          CREATE TABLE users (id INTEGER PRIMARY KEY);

          -- Create posts table
          CREATE TABLE posts (id INTEGER PRIMARY KEY);
        `,
      },
    ];

    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["0001_init"]);
  });

  it("supports partial runs when some migrations are already applied", async () => {
    const migrations1: MigrationFile[] = [
      {
        name: "0001_init",
        content: `
          CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `,
      },
    ];

    const migrations2: MigrationFile[] = [
      {
        name: "0001_init",
        content: `
          CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `,
      },
      {
        name: "0002_add_users",
        content: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
      },
    ];

    // Run first migration
    const result1 = await runMigrations(db, migrations1);
    expect(result1.applied).toEqual(["0001_init"]);

    // Run both, should only apply the new one
    const result2 = await runMigrations(db, migrations2);
    expect(result2.applied).toEqual(["0002_add_users"]);
  });

  it("enforces SQL semantics: fails if first non-init migration tries to create _migrations", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_users",
        content: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      },
      {
        name: "0002_migrations",
        content: `
          CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `,
      },
    ];

    // Should throw because first migration doesn't have 'init' in name
    await expect(runMigrations(db, migrations)).rejects.toThrow(
      /First migration must create the _migrations table/,
    );
  });

  it("validates that _migrations table exists before recording migrations", async () => {
    const migrations: MigrationFile[] = [
      {
        name: "0001_init",
        content: `
          CREATE TABLE _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
        `,
      },
    ];

    const result = await runMigrations(db, migrations);

    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["0001_init"]);
  });
});
