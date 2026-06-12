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
export async function runMigrations(
  db: Database,
  migrations: MigrationFile[],
): Promise<{
  success: boolean;
  applied: string[];
}> {
  const applied: string[] = [];

  try {
    // Ensure _migrations table exists
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      )
      .run();

    // Apply each migration that hasn't been applied yet
    for (const migration of migrations) {
      // Check if already applied
      const existing = await db
        .prepare("SELECT name FROM _migrations WHERE name = ?")
        .bind(migration.name)
        .first<{ name: string }>();

      if (existing) {
        continue; // Already applied
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
