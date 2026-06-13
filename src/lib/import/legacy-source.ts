/**
 * Legacy export readers (Epic K) — the INPUT-PARAMETER boundary of the import.
 *
 * The importer must NOT assume a fixed legacy location or format: the old SpaceJam
 * leaderboard is a separate Cloudflare D1 database, and the operator hands its export to
 * this tooling as a file. Two interchangeable formats are supported so the cutover can use
 * whichever is easiest to produce:
 *
 *   - a **sqlite file** (e.g. `wrangler d1 export spacejam-db --output legacy.sqlite`),
 *     read with the in-repo `sql.js` engine — no native bindings, no network; or
 *   - a **JSON array** of legacy snapshot rows (e.g. a `d1 ... --json` dump transformed to
 *     a flat array).
 *
 * Both yield the same loose {@link LegacySnapshotRow}[]; `transform.ts` maps them onto the
 * destination schema. Readers are pure I/O — they neither mutate the legacy source nor
 * touch the destination database — so they are safe to run against a real export during a
 * dry-run.
 */

/* eslint-disable security/detect-non-literal-fs-filename */
import { readFile } from "node:fs/promises";

import type { LegacySnapshotRow } from "./legacy-types";

/** The legacy `snapshots` columns the import consumes (extra columns are ignored). */
const LEGACY_SELECT =
  `SELECT reset_date, observed_at, agent_symbol, credits, credit_rank,` +
  ` ship_count, total_agents FROM snapshots`;

/** Narrow an unknown JSON value to a `LegacySnapshotRow`, throwing on a malformed row. */
function asLegacyRow(value: unknown, index: number): LegacySnapshotRow {
  if (typeof value !== "object" || value === null) {
    throw new Error(`legacy JSON row ${index} is not an object`);
  }
  const row = value as Record<string, unknown>;
  for (const key of ["reset_date", "observed_at", "agent_symbol"]) {
    if (typeof row[key] !== "string") {
      throw new TypeError(`legacy JSON row ${index} is missing string field "${key}"`);
    }
  }
  return row as unknown as LegacySnapshotRow;
}

/**
 * Read legacy snapshot rows from a JSON file containing a flat array of rows.
 *
 * @param path Filesystem path to the JSON export.
 */
export async function loadLegacyFromJson(
  path: string,
): Promise<LegacySnapshotRow[]> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new TypeError("legacy JSON export must be an array of snapshot rows");
  }
  return parsed.map((row, index) => asLegacyRow(row, index));
}

/** A sql.js database handle — the subset used to read the legacy export. */
interface SqlJsDb {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
}

/**
 * Read legacy snapshot rows from an already-open `sql.js` database. Split out from
 * {@link loadLegacyFromSqliteFile} so the row mapping can be unit-tested against an
 * in-memory database without filesystem access.
 *
 * @param db An open sql.js `Database` with the legacy `snapshots` table.
 */
export function readLegacySnapshots(db: SqlJsDb): LegacySnapshotRow[] {
  const result = db.exec(LEGACY_SELECT);
  if (result.length === 0 || !result[0]) return [];
  const { columns, values } = result[0];
  return values.map((rowValues) => {
    const row: Record<string, unknown> = {};
    for (const [index, column] of columns.entries()) {
      row[column] = rowValues[index];
    }
    return row as unknown as LegacySnapshotRow;
  });
}

/**
 * Read legacy snapshot rows from a sqlite file using `sql.js`.
 *
 * @param path Filesystem path to the legacy sqlite database.
 * @param sqlJsFactory The `sql.js` module initialiser (injected so tests can supply it).
 */
export async function loadLegacyFromSqliteFile(
  path: string,
  sqlJsFactory: () => Promise<{ Database: new (data: Uint8Array) => SqlJsDb }>,
): Promise<LegacySnapshotRow[]> {
  const bytes = new Uint8Array(await readFile(path));
  const SQL = await sqlJsFactory();
  const db = new SQL.Database(bytes);
  return readLegacySnapshots(db);
}
