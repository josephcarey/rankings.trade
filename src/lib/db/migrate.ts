/**
 * Migration runner for D1 database
 *
 * Forward-only, run-once pattern: migrations are numbered files, applied in order,
 * tracked in a `_migrations` table. Already-applied migrations are skipped.
 * Never edit or delete a shipped migration — only append new ones.
 */

type Database = D1Database;

export type MigrationFile = {
  name: string;
  content: string;
};

/**
 * Applies pending migrations to the database.
 *
 * Ensures the _migrations table exists, then applies each migration in order,
 * skipping any already recorded in the table.
 *
 * @param db The D1 database instance
 * @param migrations Array of migration files with name and SQL content
 * @returns Object with success flag and list of applied migration names
 * @throws Error if any migration fails
 */
/**
 * Check if the _migrations table exists and has the expected schema.
 * Returns true if the table exists, false otherwise.
 */
async function hasMigrationsTable(db: Database): Promise<boolean> {
  try {
    const result = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`,
      )
      .first<{ name: string }>();
    return !!result;
  } catch {
    return false;
  }
}

export async function runMigrations(
  db: Database,
  migrations: MigrationFile[],
): Promise<{
  success: boolean;
  applied: string[];
}> {
  const applied: string[] = [];

  try {
    // Check if _migrations table exists
    let tableExists = await hasMigrationsTable(db);

    if (!tableExists && migrations.length === 0) {
      // No migrations to apply and table doesn't exist
      return { success: true, applied };
    }

    if (!tableExists && migrations.length > 0 && !migrations[0]?.name.includes("init")) {
      // The first migration should create the _migrations table
      throw new Error(
        "First migration must create the _migrations table. Expected a migration with 'init' in the name.",
      );
    }

    // Apply each migration that hasn't been applied yet
    for (const migration of migrations) {
      // Check if already applied
      // First, update tableExists in case the migration just created it
      if (!tableExists) {
        tableExists = await hasMigrationsTable(db);
      }

      if (tableExists) {
        const existing = await db
          .prepare("SELECT name FROM _migrations WHERE name = ?")
          .bind(migration.name)
          .first<{ name: string }>();

        if (existing) {
          continue; // Already applied
        }
      }

      // Apply migration (each file may contain multiple statements)
      // Split by semicolon and filter empty statements
      const statements = migration.content
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        await db.prepare(statement).run();
      }

      // Record migration as applied
      // The _migrations table should now exist (created by the first migration)
      tableExists = await hasMigrationsTable(db);
      if (!tableExists) {
        throw new Error(
          `Migration ${migration.name} did not create _migrations table`,
        );
      }

      await db
        .prepare(
          "INSERT INTO _migrations (name, applied_at) VALUES (?, CURRENT_TIMESTAMP)",
        )
        .bind(migration.name)
        .run();

      applied.push(migration.name);
    }

    return { success: true, applied };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(`Migration failed: ${message}`, {
      cause: error,
    });
  }
}
