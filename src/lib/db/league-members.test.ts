import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  getActiveMembership,
  leaveMember,
  listActiveMembers,
  userOwnsActiveMember,
} from "./league-members";
import { createLeague } from "./leagues";
import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

/** Insert an agent (optionally owned) and return its id. */
async function insertAgent(
  db: D1Database,
  symbol: string,
  ownerUserId: number | null = null,
): Promise<number> {
  const row = await db
    .prepare(
      "INSERT INTO agents (symbol, owner_user_id) VALUES (?, ?) RETURNING id",
    )
    .bind(symbol, ownerUserId)
    .first<{ id: number }>();
  return row?.id ?? 0;
}

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

describe("league membership", () => {
  let db: D1Database;
  let leagueId: number;

  beforeEach(async () => {
    db = await makeDb();
    const league = await createLeague(db, { name: "L", owner_user_id: 1 });
    leagueId = league.id;
  });

  it("adds an active member and reads it back", async () => {
    const agentId = await insertAgent(db, "AAA");
    const member = await addMember(db, { league_id: leagueId, agent_id: agentId, added_by_user_id: 1 });
    expect(member.left_at).toBeNull();
    expect(member.added_by_user_id).toBe(1);

    const active = await getActiveMembership(db, leagueId, agentId);
    expect(active?.id).toBe(member.id);
  });

  it("adds an unclaimed agent (no owner) as a participant", async () => {
    const agentId = await insertAgent(db, "UNCLAIMED", null);
    const member = await addMember(db, { league_id: leagueId, agent_id: agentId });
    expect(member.agent_id).toBe(agentId);
    expect(member.added_by_user_id).toBeNull();
  });

  it("is idempotent — adding an active member returns the same row", async () => {
    const agentId = await insertAgent(db, "BBB");
    const first = await addMember(db, { league_id: leagueId, agent_id: agentId });
    const second = await addMember(db, { league_id: leagueId, agent_id: agentId });
    expect(second.id).toBe(first.id);

    const members = await listActiveMembers(db, leagueId);
    expect(members).toHaveLength(1);
  });

  it("leaving sets left_at and removes the agent from the active roster", async () => {
    const agentId = await insertAgent(db, "CCC");
    await addMember(db, { league_id: leagueId, agent_id: agentId });
    const left = await leaveMember(db, leagueId, agentId);
    expect(left?.left_at).not.toBeNull();

    expect(await getActiveMembership(db, leagueId, agentId)).toBeNull();
    expect(await listActiveMembers(db, leagueId)).toHaveLength(0);
  });

  it("leaving an agent that is not a member is a null no-op", async () => {
    const agentId = await insertAgent(db, "DDD");
    expect(await leaveMember(db, leagueId, agentId)).toBeNull();
  });

  it("re-adding after leaving opens a new active interval", async () => {
    const agentId = await insertAgent(db, "EEE");
    const first = await addMember(db, { league_id: leagueId, agent_id: agentId });
    await leaveMember(db, leagueId, agentId);
    const second = await addMember(db, { league_id: leagueId, agent_id: agentId });

    expect(second.id).not.toBe(first.id);
    expect(second.left_at).toBeNull();
    expect(await listActiveMembers(db, leagueId)).toHaveLength(1);
  });

  it("lists active members oldest first", async () => {
    const a = await insertAgent(db, "ONE");
    const b = await insertAgent(db, "TWO");
    await addMember(db, { league_id: leagueId, agent_id: a });
    await addMember(db, { league_id: leagueId, agent_id: b });
    const members = await listActiveMembers(db, leagueId);
    expect(members.map((m) => m.agent_id)).toEqual([a, b]);
  });
});

describe("userOwnsActiveMember", () => {
  let db: D1Database;
  let leagueId: number;

  beforeEach(async () => {
    db = await makeDb();
    const league = await createLeague(db, { name: "L", owner_user_id: 1 });
    leagueId = league.id;
  });

  it("is true when the user owns an active member agent", async () => {
    const agentId = await insertAgent(db, "OWNED", 42);
    await addMember(db, { league_id: leagueId, agent_id: agentId });
    expect(await userOwnsActiveMember(db, leagueId, 42)).toBe(true);
  });

  it("is false for a user owning no member agent", async () => {
    const agentId = await insertAgent(db, "OWNED", 42);
    await addMember(db, { league_id: leagueId, agent_id: agentId });
    expect(await userOwnsActiveMember(db, leagueId, 99)).toBe(false);
  });

  it("is false once the user's agent has left", async () => {
    const agentId = await insertAgent(db, "OWNED", 42);
    await addMember(db, { league_id: leagueId, agent_id: agentId });
    await leaveMember(db, leagueId, agentId);
    expect(await userOwnsActiveMember(db, leagueId, 42)).toBe(false);
  });

  it("never matches an unclaimed (unowned) member agent", async () => {
    const agentId = await insertAgent(db, "UNOWNED", null);
    await addMember(db, { league_id: leagueId, agent_id: agentId });
    expect(await userOwnsActiveMember(db, leagueId, 1)).toBe(false);
  });
});
