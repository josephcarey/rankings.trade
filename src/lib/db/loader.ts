/**
 * File-system based migration loader
 *
 * Loads migration files from the migrations/ directory and provides them
 * to the migration runner.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { MigrationFile } from "./migrate";

/**
 * Load all migration files from the migrations directory.
 * Sorted numerically by filename prefix (0001_, 0002_, etc.)
 *
 * @param migrationsDir Path to migrations directory
 * @returns Array of migration files with name and content
 */
export async function loadMigrations(
  migrationsDir: string,
): Promise<MigrationFile[]> {
  const files = await readdir(migrationsDir);

  const migrationFiles = files
    .filter((f) => f.endsWith(".sql"))
    .toSorted();

  const migrations: MigrationFile[] = [];

  for (const file of migrationFiles) {
    const name = file.replace(/\.sql$/, "");
    const path = resolve(migrationsDir, file);
    const content = await readFile(path, "utf8");

    migrations.push({ name, content });
  }

  return migrations;
}
