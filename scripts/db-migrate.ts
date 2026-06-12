#!/usr/bin/env bun

/**
 * CLI entry point for running D1 migrations
 *
 * Usage: bun run db:migrate
 *
 * This script expects to be run in an environment where the D1 database
 * is accessible via wrangler (local development with wrangler dev).
 */

import { resolve } from "node:path";

// This is a placeholder that documents the integration point
// In production, migrations are run within the Hono app context
// where the D1 binding is available.

const migrationsDir = resolve(import.meta.dir, "../../migrations");
console.log(`Migration runner would load migrations from: ${migrationsDir}`);
console.log(
  "Note: Migration runner is integrated into the Hono app initialization.",
);
console.log("Migrations are applied automatically when the worker starts.");
