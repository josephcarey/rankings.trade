#!/usr/bin/env bun

/**
 * CLI entry point for running D1 migrations
 *
 * Usage: bun run db:migrate
 *
 * This script expects to be run in an environment where the D1 database
 * is accessible via wrangler (local development with wrangler dev).
 *
 * To run during development:
 *   1. Start the worker: `wrangler dev`
 *   2. In another terminal: `bun run db:migrate`
 */

import { resolve } from "node:path";

import { loadMigrations } from "../src/lib/db/loader";
import { runMigrations } from "../src/lib/db/migrate";

const migrationsDir = resolve(import.meta.dir, "../migrations");

async function main(): Promise<void> {
  try {
    // Load all migration files from the migrations directory
    const migrations = await loadMigrations(migrationsDir);
    console.log(`Loaded ${migrations.length} migrations from ${migrationsDir}`);

    // Get the D1 binding from the environment
    // In wrangler dev, this is available via the worker context
    const db = globalThis.DB as D1Database;

    if (!db) {
      console.error(
        "Error: D1 database binding not available. Make sure you are running this within a wrangler dev context.",
      );
      process.exit(1);
    }

    // Run the migrations
    const result = await runMigrations(db, migrations);

    if (result.applied.length === 0) {
      console.log("No pending migrations.");
    } else {
      console.log(`Applied ${result.applied.length} migrations:`);
      for (const name of result.applied) {
        console.log(`  ✓ ${name}`);
      }
    }

    console.log("Migration runner completed successfully.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration runner failed: ${message}`);
    process.exit(1);
  }
}

await main();
