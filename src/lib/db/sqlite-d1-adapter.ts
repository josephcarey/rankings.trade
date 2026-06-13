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
  /** Rows modified by the most recently executed statement (sql.js API). */
  getRowsModified: () => number;
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
  run(): Promise<{ meta: { changes: number }; success: true }> {
    this.db.run(this.sql, this.bindings);
    return Promise.resolve({
      meta: { changes: this.db.getRowsModified() },
      success: true,
    });
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

  /**
   * Execute statements as an atomic unit, mirroring D1's all-or-nothing `batch()`.
   *
   * Real D1 `batch()` is transactional, and `applyRatingPeriod`/season-close depend on that
   * atomicity. The sequential sql.js execution is therefore wrapped in a SAVEPOINT so a failure
   * partway through rolls back every preceding statement instead of leaving a partial write.
   */
  async batch(statements: SqliteD1Statement[]): Promise<unknown[]> {
    this.db.run("SAVEPOINT d1_batch");
    try {
      const results: unknown[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.db.run("RELEASE d1_batch");
      return results;
    } catch (error) {
      // Best-effort cleanup: if a statement's conflict mode aborted the transaction the
      // savepoint may already be gone, so swallow cleanup errors and rethrow the real failure.
      try {
        this.db.run("ROLLBACK TO d1_batch");
      } catch {
        /* savepoint already unwound */
      }
      try {
        this.db.run("RELEASE d1_batch");
      } catch {
        /* savepoint already released */
      }
      throw error;
    }
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
