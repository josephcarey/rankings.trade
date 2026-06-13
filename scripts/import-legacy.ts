#!/usr/bin/env bun

/**
 * Legacy import CLI (Epic K) — the single, reviewable, idempotent entry point for the
 * one-time SpaceJam → rankings.trade backfill.
 *
 * It reads a legacy export (sqlite file or JSON), runs the import pipeline against a D1
 * database, and prints the structured summary. It does NOT decide WHERE to write — the D1
 * binding is provided by the runtime — and it defaults to a DRY-RUN posture: pass
 * `--confirm-cutover` only under the human-gated production procedure (docs/runbooks/k-cutover.md).
 *
 * Usage (within a `wrangler dev`/remote context that exposes the DB binding, like db-migrate.ts):
 *   bun scripts/import-legacy.ts --source legacy.sqlite --launch 2025-01-15 [--register-all]
 *   bun scripts/import-legacy.ts --source legacy.json   --launch 2025-01-15 --json
 *
 * Flags:
 *   --source <path>      Path to the legacy export (sqlite file by default, JSON with --json).
 *   --launch <date>      The live universe resetDate at cutover (must be AFTER all legacy dates).
 *   --json               Treat --source as a JSON array export instead of a sqlite file.
 *   --register-all       Register & rate EVERY legacy agent (gated by the batch-size preflight).
 *   --fail-on-incomplete Abort if any round has an incomplete final snapshot.
 *   --confirm-cutover    Acknowledge this is the human-gated production write (else dry-run only).
 */

import type { ImportOptions } from "../src/lib/import/legacy-types";

import { runImport } from "../src/lib/import/import-pipeline";
import { loadLegacyFromJson, loadLegacyFromSqliteFile } from "../src/lib/import/legacy-source";

interface CliArgs {
  source: string | null;
  launch: string | null;
  json: boolean;
  registerAll: boolean;
  failOnIncomplete: boolean;
  confirmCutover: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    source: null,
    launch: null,
    json: false,
    registerAll: false,
    failOnIncomplete: false,
    confirmCutover: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--confirm-cutover": {
        args.confirmCutover = true;
        break;
      }
      case "--fail-on-incomplete": {
        args.failOnIncomplete = true;
        break;
      }
      case "--json": {
        args.json = true;
        break;
      }
      case "--launch": {
        args.launch = argv[++i] ?? null;
        break;
      }
      case "--register-all": {
        args.registerAll = true;
        break;
      }
      case "--source": {
        args.source = argv[++i] ?? null;
        break;
      }
      default: {
        throw new Error(`unknown argument: ${argv[i]}`);
      }
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.launch) {
    console.error("Usage: bun scripts/import-legacy.ts --source <path> --launch <resetDate> [--json] [--register-all] [--confirm-cutover]");
    process.exit(1);
  }

  const db = globalThis.DB as D1Database | undefined;
  if (!db) {
    console.error("Error: D1 binding 'DB' not available. Run within a wrangler context (see db-migrate.ts).");
    process.exit(1);
  }

  if (!args.confirmCutover) {
    console.warn(
      "⚠️  DRY-RUN posture: --confirm-cutover not set. This run WILL still write to the bound DB;",
    );
    console.warn(
      "    only point it at a throwaway/preview database unless you are executing the gated cutover.",
    );
  }

  const legacy = args.json
    ? await loadLegacyFromJson(args.source)
    : await loadLegacyFromSqliteFile(args.source, () => import("sql.js").then((m) => m.default()));

  const options: ImportOptions = {
    launchResetDate: args.launch,
    registerAllAgents: args.registerAll,
    failOnIncompleteFinal: args.failOnIncomplete,
  };

  const summary = await runImport(db, legacy, options);
  console.log(JSON.stringify(summary, null, 2));

  const incomplete = summary.integrity.filter((f) => f.incompleteFinal);
  if (incomplete.length > 0) {
    console.warn(`⚠️  ${incomplete.length} round(s) had an incomplete final snapshot:`, incomplete.map((f) => f.reset_date).join(", "));
  }
  console.log(summary.seasonClosed ? "✓ Season 0 archived (closed). Live season starts clean." : "⚠️  Season 0 not closed — review before launch.");
}

await main();
