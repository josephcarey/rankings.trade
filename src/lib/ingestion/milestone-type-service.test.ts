import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "../leagues/league-service";

import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import {
  listLeagueMilestoneTypesForActor,
  registerLeagueMilestoneType,
} from "./milestone-type-service";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

const OWNER: Actor = { userId: 1, isAdmin: false };
const ADMIN: Actor = { userId: 99, isAdmin: true };
const STRANGER: Actor = { userId: 2, isAdmin: false };

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

/** Insert a league owned by `ownerUserId` (null = system-owned). */
async function newLeague(db: D1Database, ownerUserId: number | null): Promise<number> {
  const row = await db
    .prepare(
      "INSERT INTO leagues (name, visibility, owner_user_id) VALUES ('L', 'private', ?) RETURNING id",
    )
    .bind(ownerUserId)
    .first<{ id: number }>();
  return row?.id ?? 0;
}

describe("registerLeagueMilestoneType", () => {
  let db: D1Database;
  let leagueId: number;
  beforeEach(async () => {
    db = await makeDb();
    leagueId = await newLeague(db, OWNER.userId);
  });

  it("lets the owner register a normalized custom type", async () => {
    const result = await registerLeagueMilestoneType(db, OWNER, leagueId, "  Boss-Down ", "Boss Down");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.key).toBe("boss-down");
      expect(result.value.label).toBe("Boss Down");
      expect(result.value.league_id).toBe(leagueId);
    }
  });

  it("lets an admin register on a system-owned league", async () => {
    const systemLeague = await newLeague(db, null);
    const result = await registerLeagueMilestoneType(db, ADMIN, systemLeague, "boss-down");
    expect(result.ok).toBe(true);
  });

  it("hides an unmanageable league as not_found (IDOR) and writes nothing", async () => {
    const result = await registerLeagueMilestoneType(db, STRANGER, leagueId, "boss-down");
    expect(result).toEqual({ ok: false, reason: "not_found" });
    const list = await listLeagueMilestoneTypesForActor(db, OWNER, leagueId);
    expect(list.ok && list.value.length).toBe(0);
  });

  it("returns not_found for an unknown league", async () => {
    expect(await registerLeagueMilestoneType(db, OWNER, 9999, "boss-down")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("rejects a malformed key", async () => {
    expect(await registerLeagueMilestoneType(db, OWNER, leagueId, "Bad Key!")).toEqual({
      ok: false,
      reason: "invalid_type",
    });
  });

  it("reports a duplicate key within the league", async () => {
    await registerLeagueMilestoneType(db, OWNER, leagueId, "boss-down");
    expect(await registerLeagueMilestoneType(db, OWNER, leagueId, "boss-down")).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });
});

describe("listLeagueMilestoneTypesForActor", () => {
  let db: D1Database;
  let leagueId: number;
  beforeEach(async () => {
    db = await makeDb();
    leagueId = await newLeague(db, OWNER.userId);
    await registerLeagueMilestoneType(db, OWNER, leagueId, "boss-down");
  });

  it("returns the league's custom types for the owner", async () => {
    const result = await listLeagueMilestoneTypesForActor(db, OWNER, leagueId);
    expect(result.ok && result.value.map((t) => t.key)).toEqual(["boss-down"]);
  });

  it("hides the list from a stranger (not_found)", async () => {
    expect(await listLeagueMilestoneTypesForActor(db, STRANGER, leagueId)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
