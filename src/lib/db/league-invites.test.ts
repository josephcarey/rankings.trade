import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createInvite,
  findActiveInviteByHash,
  type LeagueInvite,
  listInvitesByLeague,
  revokeActiveInvitesForLeague,
  revokeInvite,
  rotateInvite,
} from "./league-invites";
import { createLeague } from "./leagues";
import { loadMigrations } from "./loader";
import { runMigrations } from "./migrate";
import { createSqliteD1 } from "./sqlite-d1-adapter";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

function inviteFields(leagueId: number, suffix: string): {
  league_id: number;
  token_hash: string;
  token_prefix: string;
  created_by_user_id: number;
} {
  return {
    league_id: leagueId,
    token_hash: `hash_${suffix}`,
    token_prefix: `rtlnk_${suffix}`,
    created_by_user_id: 1,
  };
}

describe("league invites", () => {
  let db: D1Database;
  let leagueId: number;

  beforeEach(async () => {
    db = await makeDb();
    const league = await createLeague(db, { name: "L", owner_user_id: 1 });
    leagueId = league.id;
  });

  it("creates an active invite and finds it by hash", async () => {
    const invite = await createInvite(db, inviteFields(leagueId, "a"));
    expect(invite.revoked_at).toBeNull();

    const found = await findActiveInviteByHash(db, "hash_a");
    expect(found?.id).toBe(invite.id);
  });

  it("does not find an unknown hash", async () => {
    expect(await findActiveInviteByHash(db, "nope")).toBeNull();
  });

  it("a reusable active invite is found across repeated lookups", async () => {
    await createInvite(db, inviteFields(leagueId, "a"));
    const one = await findActiveInviteByHash(db, "hash_a");
    const two = await findActiveInviteByHash(db, "hash_a");
    expect(one?.id).toBe(two?.id);
  });

  it("revokes an invite so it is no longer found by hash", async () => {
    const invite = await createInvite(db, inviteFields(leagueId, "a"));
    const revoked = await revokeInvite(db, invite.id, leagueId);
    expect(revoked?.revoked_at).not.toBeNull();
    expect(await findActiveInviteByHash(db, "hash_a")).toBeNull();
  });

  it("revoke is idempotent and preserves the original revoked_at", async () => {
    const invite = await createInvite(db, inviteFields(leagueId, "a"));
    const first = await revokeInvite(db, invite.id, leagueId);
    const second = await revokeInvite(db, invite.id, leagueId);
    expect(second?.revoked_at).toBe(first?.revoked_at);
  });

  it("revoke is scoped to the league (IDOR-safe)", async () => {
    const other = await createLeague(db, { name: "Other", owner_user_id: 2 });
    const invite = await createInvite(db, inviteFields(leagueId, "a"));

    // Attempt to revoke from the wrong league: no-op, still active.
    expect(await revokeInvite(db, invite.id, other.id)).toBeNull();
    expect(await findActiveInviteByHash(db, "hash_a")).not.toBeNull();
  });

  it("lists invites newest first", async () => {
    await createInvite(db, inviteFields(leagueId, "a"));
    await createInvite(db, inviteFields(leagueId, "b"));
    const invites = await listInvitesByLeague(db, leagueId);
    expect(invites.map((i: LeagueInvite) => i.token_hash)).toEqual([
      "hash_b",
      "hash_a",
    ]);
  });

  it("revokeActiveInvitesForLeague revokes only active links and counts them", async () => {
    const a = await createInvite(db, inviteFields(leagueId, "a"));
    await createInvite(db, inviteFields(leagueId, "b"));
    await revokeInvite(db, a.id, leagueId);

    const count = await revokeActiveInvitesForLeague(db, leagueId);
    expect(count).toBe(1);
    expect(await findActiveInviteByHash(db, "hash_b")).toBeNull();
  });

  it("rotate revokes the old link and issues a fresh active one", async () => {
    await createInvite(db, inviteFields(leagueId, "old"));
    const fresh = await rotateInvite(db, inviteFields(leagueId, "new"));

    expect(await findActiveInviteByHash(db, "hash_old")).toBeNull();
    const active = await findActiveInviteByHash(db, "hash_new");
    expect(active?.id).toBe(fresh.id);
  });
});
