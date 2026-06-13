import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function indexExists(db: D1Database, name: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .bind(name)
    .first<{ name: string }>();
  return row?.name === name;
}

/** Insert a league and return its generated id. */
async function insertLeague(
  db: D1Database,
  fields: { name?: string; visibility?: string } = {},
): Promise<number> {
  await db
    .prepare("INSERT INTO leagues (name, visibility, owner_user_id) VALUES (?, ?, ?)")
    .bind(fields.name ?? "Test League", fields.visibility ?? "private", 1)
    .run();
  const row = await db
    .prepare("SELECT id FROM leagues ORDER BY id DESC LIMIT 1")
    .first<{ id: number }>();
  return row?.id ?? 0;
}

async function addMember(
  db: D1Database,
  leagueId: number,
  agentId: number,
): Promise<void> {
  await db
    .prepare("INSERT INTO league_members (league_id, agent_id) VALUES (?, ?)")
    .bind(leagueId, agentId)
    .run();
}

describe("0004_leagues migration", () => {
  let db: D1Database;

  beforeEach(async () => {
    const SQL = await Database();
    db = createSqliteD1(new SQL.Database());

    const migrations = await loadMigrations(migrationsDir);
    const result = await runMigrations(db, migrations);
    expect(result.success).toBe(true);
    expect(result.applied).toContain("0004_leagues");
  });

  it("defaults new leagues to private visibility", async () => {
    await db
      .prepare("INSERT INTO leagues (name, owner_user_id) VALUES (?, ?)")
      .bind("Defaults", 1)
      .run();

    const row = await db
      .prepare("SELECT visibility FROM leagues WHERE name = ?")
      .bind("Defaults")
      .first<{ visibility: string }>();

    expect(row?.visibility).toBe("private");
  });

  it("rejects an invalid visibility value", async () => {
    await expect(insertLeague(db, { visibility: "secret" })).rejects.toThrow();
  });

  it("rejects an empty league name", async () => {
    await expect(insertLeague(db, { name: "" })).rejects.toThrow();
  });

  it("allows a public visibility value", async () => {
    const id = await insertLeague(db, { visibility: "public" });
    expect(id).toBeGreaterThan(0);
  });

  it("allows a NULL owner (system-owned league)", async () => {
    await db
      .prepare("INSERT INTO leagues (name, owner_user_id) VALUES (?, ?)")
      .bind("System League", null)
      .run();

    const row = await db
      .prepare("SELECT owner_user_id FROM leagues WHERE name = ?")
      .bind("System League")
      .first<{ owner_user_id: number | null }>();

    expect(row?.owner_user_id).toBeNull();
  });

  it("permits only one active membership per agent per league", async () => {
    const leagueId = await insertLeague(db);
    await addMember(db, leagueId, 1);
    await expect(addMember(db, leagueId, 1)).rejects.toThrow();
  });

  it("allows re-adding an agent after it has left (new interval)", async () => {
    const leagueId = await insertLeague(db);
    await addMember(db, leagueId, 1);

    await db
      .prepare(
        "UPDATE league_members SET left_at = CURRENT_TIMESTAMP WHERE league_id = ? AND agent_id = ?",
      )
      .bind(leagueId, 1)
      .run();

    // A new active row for the same (league, agent) is now permitted.
    await expect(addMember(db, leagueId, 1)).resolves.toBeUndefined();

    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM league_members WHERE league_id = ? AND agent_id = ?")
      .bind(leagueId, 1)
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("allows the same agent to be active in two different leagues", async () => {
    const a = await insertLeague(db, { name: "A" });
    const b = await insertLeague(db, { name: "B" });
    await addMember(db, a, 7);
    await expect(addMember(db, b, 7)).resolves.toBeUndefined();
  });

  it("rejects left_at earlier than joined_at", async () => {
    const leagueId = await insertLeague(db);
    await expect(
      (async () =>
        db
          .prepare(
            "INSERT INTO league_members (league_id, agent_id, joined_at, left_at) VALUES (?, ?, ?, ?)",
          )
          .bind(leagueId, 1, "2026-06-02T00:00:00", "2026-06-01T00:00:00")
          .run())(),
    ).rejects.toThrow();
  });

  it("enforces a unique token_hash on invites", async () => {
    const leagueId = await insertLeague(db);
    const insertInvite = async () =>
      db
        .prepare(
          "INSERT INTO league_invites (league_id, token_hash, token_prefix, created_by_user_id) VALUES (?, ?, ?, ?)",
        )
        .bind(leagueId, "deadbeef", "rtlnk_a", 1)
        .run();

    await insertInvite();
    await expect(insertInvite()).rejects.toThrow();
  });

  it("creates the membership and invite indexes", async () => {
    expect(await indexExists(db, "idx_league_members_active")).toBe(true);
    expect(await indexExists(db, "idx_league_members_league")).toBe(true);
    expect(await indexExists(db, "idx_league_members_agent")).toBe(true);
    expect(await indexExists(db, "idx_league_invites_league")).toBe(true);
  });
});
