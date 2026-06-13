import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "./league-service";

import { getAgentBySymbol } from "../db/agents";
import { addMember, leaveMember } from "../db/league-members";
import { getLeagueById } from "../db/leagues";
import { loadMigrations } from "../db/loader";
import { runMigrations } from "../db/migrate";
import { createSqliteD1 } from "../db/sqlite-d1-adapter";
import {
  acceptInvite,
  addParticipant,
  createLeagueForActor,
  createLeagueInvite,
  getViewableLeague,
  listLeagueInvites,
  listParticipants,
  removeParticipant,
  revokeLeagueInvite,
  rotateLeagueInvite,
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

describe("addParticipant", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("adds an unknown callsign as a new unclaimed participant", async () => {
    const id = await newLeague(db);
    const result = await addParticipant(db, OWNER, id, "newbot");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.symbol).toBe("NEWBOT");
    expect(result.value.owner_user_id).toBeNull();

    // The agent row was auto-created.
    const agent = await getAgentBySymbol(db, "NEWBOT");
    expect(agent).not.toBeNull();
  });

  it("adds an existing claimed agent without changing its owner", async () => {
    const id = await newLeague(db);
    await insertAgent(db, "OWNED", 5);
    const result = await addParticipant(db, OWNER, id, "owned");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.owner_user_id).toBe(5);
  });

  it("lets an admin add to a league they do not own", async () => {
    const id = await newLeague(db);
    const result = await addParticipant(db, ADMIN, id, "adminbot");
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid callsign", async () => {
    const id = await newLeague(db);
    expect(await addParticipant(db, OWNER, id, "x")).toEqual({
      ok: false,
      reason: "invalid_symbol",
    });
  });

  it("hides the league from a non-owner non-admin and adds nothing", async () => {
    const id = await newLeague(db);
    expect(await addParticipant(db, STRANGER, id, "sneaky")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await getAgentBySymbol(db, "SNEAKY")).toBeNull();
  });

  it("is idempotent for an already-active participant", async () => {
    const id = await newLeague(db);
    await addParticipant(db, OWNER, id, "dupe");
    await addParticipant(db, OWNER, id, "dupe");
    const list = await listParticipants(db, OWNER, id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value).toHaveLength(1);
  });
});

describe("removeParticipant", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("removes an active participant", async () => {
    const id = await newLeague(db);
    await addParticipant(db, OWNER, id, "leaver");
    const result = await removeParticipant(db, OWNER, id, "leaver");
    expect(result.ok).toBe(true);

    const list = await listParticipants(db, OWNER, id);
    if (!list.ok) return;
    expect(list.value).toHaveLength(0);
  });

  it("returns not_found for an unknown callsign", async () => {
    const id = await newLeague(db);
    expect(await removeParticipant(db, OWNER, id, "ghost")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns not_found for an agent that is not a participant", async () => {
    const id = await newLeague(db);
    await insertAgent(db, "OUTSIDER", null);
    expect(await removeParticipant(db, OWNER, id, "outsider")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("hides the league from a non-owner non-admin and removes nothing", async () => {
    const id = await newLeague(db);
    await addParticipant(db, OWNER, id, "keepme");
    expect(await removeParticipant(db, STRANGER, id, "keepme")).toEqual({
      ok: false,
      reason: "not_found",
    });
    const list = await listParticipants(db, OWNER, id);
    if (!list.ok) return;
    expect(list.value).toHaveLength(1);
  });

  it("lets an admin remove from a league they do not own", async () => {
    const id = await newLeague(db);
    await addParticipant(db, OWNER, id, "adminrm");
    const result = await removeParticipant(db, ADMIN, id, "adminrm");
    expect(result.ok).toBe(true);
  });
});

describe("listParticipants", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("lists the active roster for the owner", async () => {
    const id = await newLeague(db);
    await addParticipant(db, OWNER, id, "one");
    await addParticipant(db, OWNER, id, "two");
    const result = await listParticipants(db, OWNER, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.symbol)).toEqual(["ONE", "TWO"]);
  });

  it("hides a private roster from an unrelated user", async () => {
    const id = await newLeague(db, "private");
    await addParticipant(db, OWNER, id, "secret");
    expect(await listParticipants(db, STRANGER, id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("shows a public roster to an anonymous caller", async () => {
    const id = await newLeague(db, "public");
    await addParticipant(db, OWNER, id, "pub");
    const result = await listParticipants(db, null, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
  });
});

/** An actor who owns agents and joins via invite. */
const JOINER: Actor = { userId: 7, isAdmin: false };

describe("createLeagueInvite", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("creates an active invite and returns the one-time token", async () => {
    const id = await newLeague(db);
    const result = await createLeagueInvite(db, OWNER, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.token.startsWith("rtlnk_")).toBe(true);
    expect(result.value.invite.revoked_at).toBeNull();
    expect(result.value.invite.league_id).toBe(id);
  });

  it("lets an admin create an invite for a league they do not own", async () => {
    const id = await newLeague(db);
    const result = await createLeagueInvite(db, ADMIN, id);
    expect(result.ok).toBe(true);
  });

  it("hides the league from a non-owner non-admin", async () => {
    const id = await newLeague(db);
    expect(await createLeagueInvite(db, STRANGER, id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("acceptInvite", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  async function setupInvite(): Promise<{ leagueId: number; token: string }> {
    const leagueId = await newLeague(db);
    const created = await createLeagueInvite(db, OWNER, leagueId);
    if (!created.ok) throw new Error("setup: createLeagueInvite failed");
    return { leagueId, token: created.value.token };
  }

  it("joins the actor's own agent to the invite's league", async () => {
    const { leagueId, token } = await setupInvite();
    const agentId = await insertAgent(db, "MINE", JOINER.userId);
    const result = await acceptInvite(db, JOINER, token, agentId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leagueId).toBe(leagueId);
    expect(result.value.symbol).toBe("MINE");

    const roster = await listParticipants(db, OWNER, leagueId);
    if (!roster.ok) return;
    expect(roster.value.map((p) => p.symbol)).toEqual(["MINE"]);
  });

  it("rejects an unknown token", async () => {
    await setupInvite();
    const agentId = await insertAgent(db, "MINE", JOINER.userId);
    expect(await acceptInvite(db, JOINER, "rtlnk_nope", agentId)).toEqual({
      ok: false,
      reason: "invalid_invite",
    });
  });

  it("rejects a revoked token", async () => {
    const { leagueId, token } = await setupInvite();
    const list = await listLeagueInvites(db, OWNER, leagueId);
    if (!list.ok || !list.value[0]) throw new Error("setup: no invite");
    await revokeLeagueInvite(db, OWNER, leagueId, list.value[0].id);
    const agentId = await insertAgent(db, "MINE", JOINER.userId);
    expect(await acceptInvite(db, JOINER, token, agentId)).toEqual({
      ok: false,
      reason: "invalid_invite",
    });
  });

  it("rejects an agent the actor does not own", async () => {
    const { token } = await setupInvite();
    const agentId = await insertAgent(db, "THEIRS", OWNER.userId);
    expect(await acceptInvite(db, JOINER, token, agentId)).toEqual({
      ok: false,
      reason: "agent_not_owned",
    });
  });

  it("rejects an unknown agent id", async () => {
    const { token } = await setupInvite();
    expect(await acceptInvite(db, JOINER, token, 9999)).toEqual({
      ok: false,
      reason: "agent_not_owned",
    });
  });

  it("is idempotent for an already-active agent", async () => {
    const { leagueId, token } = await setupInvite();
    const agentId = await insertAgent(db, "MINE", JOINER.userId);
    await acceptInvite(db, JOINER, token, agentId);
    await acceptInvite(db, JOINER, token, agentId);
    const roster = await listParticipants(db, OWNER, leagueId);
    if (!roster.ok) return;
    expect(roster.value).toHaveLength(1);
  });

  it("opens a new interval after the agent previously left", async () => {
    const { leagueId, token } = await setupInvite();
    const agentId = await insertAgent(db, "MINE", JOINER.userId);
    await acceptInvite(db, JOINER, token, agentId);
    await leaveMember(db, leagueId, agentId);

    const rejoin = await acceptInvite(db, JOINER, token, agentId);
    expect(rejoin.ok).toBe(true);
    const roster = await listParticipants(db, OWNER, leagueId);
    if (!roster.ok) return;
    expect(roster.value).toHaveLength(1);
  });
});

describe("rotateLeagueInvite", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("invalidates the old URL and the new one works", async () => {
    const id = await newLeague(db);
    const first = await createLeagueInvite(db, OWNER, id);
    if (!first.ok) throw new Error("setup failed");

    const rotated = await rotateLeagueInvite(db, OWNER, id);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    const agentId = await insertAgent(db, "MINE", JOINER.userId);
    expect(await acceptInvite(db, JOINER, first.value.token, agentId)).toEqual({
      ok: false,
      reason: "invalid_invite",
    });
    const rejoin = await acceptInvite(db, JOINER, rotated.value.token, agentId);
    expect(rejoin.ok).toBe(true);
  });

  it("hides the league from a non-owner non-admin", async () => {
    const id = await newLeague(db);
    expect(await rotateLeagueInvite(db, STRANGER, id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("revokeLeagueInvite", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("revokes an invite so it can no longer be accepted", async () => {
    const id = await newLeague(db);
    const created = await createLeagueInvite(db, OWNER, id);
    if (!created.ok) throw new Error("setup failed");

    const result = await revokeLeagueInvite(db, OWNER, id, created.value.invite.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revoked_at).not.toBeNull();
  });

  it("returns not_found for an invite not in the league", async () => {
    const id = await newLeague(db);
    expect(await revokeLeagueInvite(db, OWNER, id, 9999)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("hides the league from a non-owner non-admin", async () => {
    const id = await newLeague(db);
    const created = await createLeagueInvite(db, OWNER, id);
    if (!created.ok) throw new Error("setup failed");
    expect(
      await revokeLeagueInvite(db, STRANGER, id, created.value.invite.id),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("listLeagueInvites", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("lists invites for the owner", async () => {
    const id = await newLeague(db);
    await createLeagueInvite(db, OWNER, id);
    const result = await listLeagueInvites(db, OWNER, id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
  });

  it("hides invites from a non-owner non-admin", async () => {
    const id = await newLeague(db);
    expect(await listLeagueInvites(db, STRANGER, id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
