/* eslint-disable security/detect-non-literal-fs-filename */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./loader";

describe("loadMigrations", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "migrations-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads and sorts migration files numerically", async () => {
    // Create test migration files
    await writeFile(join(testDir, "0001_init.sql"), "CREATE TABLE users;");
    await writeFile(join(testDir, "0002_posts.sql"), "CREATE TABLE posts;");
    await writeFile(join(testDir, "0003_index.sql"), "CREATE INDEX idx_posts;");

    const migrations = await loadMigrations(testDir);

    expect(migrations.length).toBe(3);
    expect(migrations[0]?.name).toBe("0001_init");
    expect(migrations[1]?.name).toBe("0002_posts");
    expect(migrations[2]?.name).toBe("0003_index");
  });

  it("loads migration content correctly", async () => {
    const content = "CREATE TABLE users (id INTEGER PRIMARY KEY);";
    await writeFile(join(testDir, "0001_init.sql"), content);

    const migrations = await loadMigrations(testDir);

    expect(migrations.length).toBe(1);
    expect(migrations[0]?.content).toBe(content);
  });

  it("ignores non-SQL files", async () => {
    await writeFile(join(testDir, "0001_init.sql"), "CREATE TABLE users;");
    await writeFile(join(testDir, "README.md"), "# Migrations");
    await writeFile(join(testDir, "0002_posts.sql"), "CREATE TABLE posts;");

    const migrations = await loadMigrations(testDir);

    expect(migrations.length).toBe(2);
    expect(migrations.map((m) => m.name)).toEqual(["0001_init", "0002_posts"]);
  });

  it("handles empty migrations directory", async () => {
    const migrations = await loadMigrations(testDir);

    expect(migrations.length).toBe(0);
  });

  it("sorts migrations with mixed-digit prefixes correctly", async () => {
    await writeFile(join(testDir, "0009_init.sql"), "CREATE TABLE a;");
    await writeFile(join(testDir, "0010_posts.sql"), "CREATE TABLE b;");
    await writeFile(join(testDir, "0001_early.sql"), "CREATE TABLE c;");

    const migrations = await loadMigrations(testDir);

    expect(migrations.map((m) => m.name)).toEqual([
      "0001_early",
      "0009_init",
      "0010_posts",
    ]);
  });
});
