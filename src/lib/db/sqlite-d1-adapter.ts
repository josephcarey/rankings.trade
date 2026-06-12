/**
 * Executable in-memory D1 adapter backed by sql.js, for tests (Epic D, card #18).
 *
 * Unlike the minimal stubs inlined in some earlier test files, this adapter actually
 * executes statements — including `batch()` — so chunked batch upserts, idempotency, and
 * read-back queries can be verified against real SQLite semantics without a network or a
 * Worker runtime. Shared so the store and orchestrator suites can reuse it.
 */

type SqlJsDatabase = {
  exec: (
    sql: string,
    params?: unknown[],
  ) => Array<{ columns: string[]; values: unknown[][] }>;
  run: (sql: string, params?: unknown[]) => void;
};

class SqliteD1Statement {
  constructor(
    private readonly sql: string,
    private readonly db: SqlJsDatabase,
    private readonly bindings: unknown[] = [],
  ) {}

  all<T>(): Promise<{ results: T[]; success: true }> {
    return Promise.resolve({ results: this.rows<T>(), success: true });
  }

  /** Like D1, returns a NEW bound statement rather than mutating this one. */
  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.sql, this.db, params);
  }

  first<T>(): Promise<T | null> {
    const [first] = this.rows<T>();
    return Promise.resolve(first ?? null);
  }

  /** Execute a write statement. Used directly and by {@link SqliteD1Database.batch}. */
  run(): Promise<{ success: true }> {
    this.db.run(this.sql, this.bindings);
    return Promise.resolve({ success: true });
  }

  private rows<T>(): T[] {
    const result = this.db.exec(this.sql, this.bindings);
    if (result.length === 0 || !result[0]) return [];
    const { columns, values } = result[0];
    return values.map((rowValues) => {
      const row: Record<string, unknown> = {};
      for (const [index, column] of columns.entries()) {
        row[column] = rowValues[index];
      }
      return row as T;
    });
  }
}

class SqliteD1Database {
  constructor(private readonly db: SqlJsDatabase) {}

  async batch(statements: SqliteD1Statement[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(sql, this.db);
  }
}

/**
 * Wrap a sql.js `Database` in a D1-compatible facade.
 *
 * @param db A sql.js `Database` instance with the schema already applied.
 * @returns An object satisfying the subset of the D1 API used by the scrape pipeline.
 */
export function createSqliteD1(db: unknown): D1Database {
  return new SqliteD1Database(db as SqlJsDatabase) as unknown as D1Database;
}
