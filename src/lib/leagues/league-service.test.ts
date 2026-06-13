import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "./league-service";

import { addMember, leaveMember } from "../db/league-members";
import { getLeagueById } from "../db/leagues";
import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import {
  createLeagueForActor,
  getViewableLeague,
  updateLeagueDetails,
} from "./league-service";

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

async function insertAgent(
  db: D1Database,
  symbol: string,
  ownerUserId: number | null,
): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol, owner_user_id) VALUES (?, ?) RETURNING id")
    .bind(symbol, ownerUserId)
    .first<{ id: number }>();
  return row?.id ?? 0;
}

/** Create a league owned by OWNER and return its id. */
async function newLeague(
  db: D1Database,
  visibility: "private" | "public" = "private",
): Promise<number> {
  const result = await createLeagueForActor(db, OWNER, { name: "L", visibility });
  if (!result.ok) throw new Error("setup: createLeagueForActor failed");
  return result.value.id;
}

describe("createLeagueForActor", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("creates a private league owned by the actor", async () => {
    const result = await createLeagueForActor(db, OWNER, { name: "  Friends  " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Friends");
    expect(result.value.visibility).toBe("private");
    expect(result.value.owner_user_id).toBe(OWNER.userId);
  });

  it("rejects a blank name", async () => {
    const result = await createLeagueForActor(db, OWNER, { name: ' '.repeat(3) });
    expect(result).toEqual({ ok: false, reason: "invalid_name" });
  });
});

describe("getViewableLeague", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("shows a public league to an anonymous caller", async () => {
    const id = await newLeague(db, "public");
    const result = await getViewableLeague(db, null, id);
    expect(result.ok).toBe(true);
  });

  it("shows a public league to any signed-in user", async () => {
    const id = await newLeague(db, "public");
    const result = await getViewableLeague(db, STRANGER, id);
    expect(result.ok).toBe(true);
  });

  it("hides a private league from an anonymous caller", async () => {
    const id = await newLeague(db, "private");
    expect(await getViewableLeague(db, null, id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("hides a private league from an unrelated user", async () => {
    const id = await newLeague(db, "private");
    expect(await getViewableLeague(db, STRANGER, id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("shows a private league to its owner", async () => {
    const id = await newLeague(db, "private");
    const result = await getViewableLeague(db, OWNER, id);
    expect(result.ok).toBe(true);
  });

  it("shows a private league to an admin", async () => {
    const id = await newLeague(db, "private");
    const result = await getViewableLeague(db, ADMIN, id);
    expect(result.ok).toBe(true);
  });

  it("shows a private league to a user who owns an active member agent", async () => {
    const id = await newLeague(db, "private");
    const agentId = await insertAgent(db, "MINE", STRANGER.userId);
    await addMember(db, { league_id: id, agent_id: agentId });
    const result = await getViewableLeague(db, STRANGER, id);
    expect(result.ok).toBe(true);
  });

  it("hides a private league once the user's agent has left", async () => {
    const id = await newLeague(db, "private");
    const agentId = await insertAgent(db, "MINE", STRANGER.userId);
    await addMember(db, { league_id: id, agent_id: agentId });
    await leaveMember(db, id, agentId);
    expect(await getViewableLeague(db, STRANGER, id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns not_found for an unknown league", async () => {
    expect(await getViewableLeague(db, OWNER, 4242)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("updateLeagueDetails", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("lets the owner rename and change visibility", async () => {
    const id = await newLeague(db);
    const result = await updateLeagueDetails(db, OWNER, id, {
      name: "Renamed",
      visibility: "public",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Renamed");
    expect(result.value.visibility).toBe("public");
  });

  it("lets an admin update a league they do not own", async () => {
    const id = await newLeague(db);
    const result = await updateLeagueDetails(db, ADMIN, id, { description: "set by admin" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBe("set by admin");
  });

  it("hides the league from a non-owner non-admin (IDOR-safe)", async () => {
    const id = await newLeague(db);
    expect(await updateLeagueDetails(db, STRANGER, id, { name: "Hacked" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    // The league is unchanged.
    const after = await getLeagueById(db, id);
    expect(after?.name).toBe("L");
  });

  it("rejects an invalid new name before touching the database", async () => {
    const id = await newLeague(db);
    expect(await updateLeagueDetails(db, OWNER, id, { name: "" })).toEqual({
      ok: false,
      reason: "invalid_name",
    });
  });

  it("returns not_found for an unknown league", async () => {
    expect(await updateLeagueDetails(db, OWNER, 4242, { name: "X" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
