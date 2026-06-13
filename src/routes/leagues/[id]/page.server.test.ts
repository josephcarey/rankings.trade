import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { getAgentBySymbol } from "../../../lib/db/agents";
import { addMember } from "../../../lib/db/league-members";
import { getLeagueById } from "../../../lib/db/leagues";
import { loadMigrations } from "../../../lib/db/loader";
import { runMigrations } from "../../../lib/db/migrate";
import { createSqliteD1 } from "../../../lib/db/sqlite-d1-adapter";
import { createLeagueForActor } from "../../../lib/leagues/league-service";
import { actions, load } from "./+page.server";

const migrationsDir = fileURLToPath(
  new URL("../../../../migrations", import.meta.url),
);

const OWNER = { actor: { isAdmin: false, userId: 1 }, user: { id: 1 } };
const STRANGER = { user: { id: 2 } };

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

function platform(db: D1Database) {
  return { env: { ADMIN_CLERK_USER_IDS: "", DB: db } };
}

async function newLeague(
  db: D1Database,
  visibility: "private" | "public",
): Promise<number> {
  const result = await createLeagueForActor(db, OWNER.actor, {
    name: "League",
    visibility,
  });
  if (!result.ok) throw new Error("setup failed");
  return result.value.id;
}

function formRequest(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://app.test/leagues/1", { body, method: "POST" });
}

describe("league detail page server", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  describe("load", () => {
    // eslint-disable-next-line unicorn/consistent-function-scoping -- closes over per-test db
    function invoke(id: string, user: unknown, userId: null | string = null) {
      return load({
        locals: { user, userId },
        params: { id },
        platform: platform(db),
      } as never);
    }

    it("shows a public league to an anonymous caller without manage rights", async () => {
      const id = await newLeague(db, "public");
      const result = (await invoke(String(id), null)) as {
        canManage: boolean;
        league: { name: string };
      };
      expect(result.league.name).toBe("League");
      expect(result.canManage).toBe(false);
    });

    it("lets the owner view and manage a private league", async () => {
      const id = await newLeague(db, "private");
      const result = (await invoke(String(id), OWNER.user, "u1")) as {
        canManage: boolean;
      };
      expect(result.canManage).toBe(true);
    });

    it("404s a private league for a stranger", async () => {
      const id = await newLeague(db, "private");
      await expect(invoke(String(id), STRANGER.user)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("404s a private league for an anonymous caller", async () => {
      const id = await newLeague(db, "private");
      await expect(invoke(String(id), null)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("404s a malformed id", async () => {
      await expect(invoke("abc", OWNER.user)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("lets a member-agent owner view a private league", async () => {
      const id = await newLeague(db, "private");
      const agent = await db
        .prepare("INSERT INTO agents (symbol, owner_user_id) VALUES (?, ?) RETURNING id")
        .bind("MEMBR", 2)
        .first<{ id: number }>();
      await addMember(db, { agent_id: agent?.id ?? 0, league_id: id });

      const result = (await invoke(String(id), STRANGER.user)) as {
        canManage: boolean;
      };
      expect(result.canManage).toBe(false);
    });
  });

  describe("update action", () => {
    const runUpdate = actions.update as NonNullable<typeof actions.update>;

    function invoke(
      id: string,
      fields: Record<string, string>,
      user: unknown,
      userId: null | string = null,
    ) {
      return runUpdate({
        locals: { user, userId },
        params: { id },
        platform: platform(db),
        request: formRequest(fields),
      } as never);
    }

    it("updates a league for its owner", async () => {
      const id = await newLeague(db, "private");
      const result = (await invoke(
        String(id),
        { name: "Renamed", visibility: "public" },
        OWNER.user,
        "u1",
      )) as { form: { message: string } };
      expect(result.form.message).toBe("League updated.");

      const league = await getLeagueById(db, id);
      expect(league?.name).toBe("Renamed");
      expect(league?.visibility).toBe("public");
    });

    it("rejects a blank name with a 400", async () => {
      const id = await newLeague(db, "private");
      const result = (await invoke(String(id), { name: " " }, OWNER.user, "u1")) as {
        data: { form: { valid: boolean } };
        status: number;
      };
      expect(result.status).toBe(400);
      expect(result.data.form.valid).toBe(false);
    });

    it("404s an update from a stranger", async () => {
      const id = await newLeague(db, "private");
      await expect(
        invoke(String(id), { name: "Hijack" }, STRANGER.user, "u2"),
      ).rejects.toMatchObject({ status: 404 });

      const league = await getLeagueById(db, id);
      expect(league?.name).toBe("League");
    });

    it("redirects an anonymous update to sign-in", async () => {
      const id = await newLeague(db, "private");
      await expect(
        invoke(String(id), { name: "Anon" }, null),
      ).rejects.toMatchObject({ status: 302 });
    });
  });

  describe("participant actions", () => {
    const runAdd = actions.addParticipant as NonNullable<
      typeof actions.addParticipant
    >;
    const runRemove = actions.removeParticipant as NonNullable<
      typeof actions.removeParticipant
    >;

    function add(
      id: string,
      symbol: string,
      user: unknown,
      userId: null | string = null,
    ) {
      return runAdd({
        locals: { user, userId },
        params: { id },
        platform: platform(db),
        request: formRequest({ symbol }),
      } as never);
    }

    function remove(
      id: string,
      symbol: string,
      user: unknown,
      userId: null | string = null,
    ) {
      return runRemove({
        locals: { user, userId },
        params: { id },
        platform: platform(db),
        request: formRequest({ symbol }),
      } as never);
    }

    it("lets the owner add an unclaimed participant by callsign", async () => {
      const id = await newLeague(db, "private");
      const result = (await add(String(id), "newbot", OWNER.user, "u1")) as {
        added: { owner_user_id: null | number; symbol: string };
      };
      expect(result.added.symbol).toBe("NEWBOT");
      expect(result.added.owner_user_id).toBeNull();

      const roster = await load({
        locals: { user: OWNER.user, userId: "u1" },
        params: { id: String(id) },
        platform: platform(db),
      } as never);
      expect((roster as { participants: unknown[] }).participants).toHaveLength(1);
    });

    it("rejects an invalid callsign with a 400", async () => {
      const id = await newLeague(db, "private");
      const result = (await add(String(id), "x", OWNER.user, "u1")) as {
        data: { action: string };
        status: number;
      };
      expect(result.status).toBe(400);
      expect(result.data.action).toBe("addParticipant");
    });

    it("404s an add from a stranger and writes nothing", async () => {
      const id = await newLeague(db, "private");
      await expect(
        add(String(id), "sneaky", STRANGER.user, "u2"),
      ).rejects.toMatchObject({ status: 404 });
      expect(await getAgentBySymbol(db, "SNEAKY")).toBeNull();
    });

    it("removes an active participant for the owner", async () => {
      const id = await newLeague(db, "private");
      await add(String(id), "leaver", OWNER.user, "u1");
      const result = (await remove(String(id), "leaver", OWNER.user, "u1")) as {
        removed: { symbol: string };
      };
      expect(result.removed.symbol).toBe("LEAVER");

      const roster = await load({
        locals: { user: OWNER.user, userId: "u1" },
        params: { id: String(id) },
        platform: platform(db),
      } as never);
      expect((roster as { participants: unknown[] }).participants).toHaveLength(0);
    });

    it("404s a remove of a non-participant", async () => {
      const id = await newLeague(db, "private");
      await expect(
        remove(String(id), "ghost", OWNER.user, "u1"),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("invite actions", () => {
    const runCreate = actions.createInvite as NonNullable<
      typeof actions.createInvite
    >;
    const runRevoke = actions.revokeInvite as NonNullable<
      typeof actions.revokeInvite
    >;

    // eslint-disable-next-line unicorn/consistent-function-scoping -- closes over per-test db
    function base(id: string, user: unknown, userId: null | string) {
      return {
        locals: { user, userId },
        params: { id },
        platform: platform(db),
        url: new URL("https://app.test/leagues/1"),
      };
    }

    it("creates a join link and returns a shareable URL once", async () => {
      const id = await newLeague(db, "private");
      const result = (await runCreate(
        base(String(id), OWNER.user, "u1") as never,
      )) as { joinUrl: string };
      expect(result.joinUrl).toMatch(
        /^https:\/\/app\.test\/leagues\/join\/rtlnk_/,
      );

      const loaded = (await load({
        locals: { user: OWNER.user, userId: "u1" },
        params: { id: String(id) },
        platform: platform(db),
      } as never)) as { invites: { revoked_at: null | string }[] };
      expect(loaded.invites).toHaveLength(1);
    });

    it("404s an invite create from a stranger", async () => {
      const id = await newLeague(db, "private");
      await expect(
        runCreate(base(String(id), STRANGER.user, "u2") as never),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("rotates the join link and returns a fresh URL", async () => {
      const runRotate = actions.rotateInvite as NonNullable<
        typeof actions.rotateInvite
      >;
      const id = await newLeague(db, "private");
      const first = (await runCreate(
        base(String(id), OWNER.user, "u1") as never,
      )) as { joinUrl: string };
      const rotated = (await runRotate(
        base(String(id), OWNER.user, "u1") as never,
      )) as { joinUrl: string };
      expect(rotated.joinUrl).toMatch(/\/leagues\/join\/rtlnk_/);
      expect(rotated.joinUrl).not.toBe(first.joinUrl);

      const loaded = (await load({
        locals: { user: OWNER.user, userId: "u1" },
        params: { id: String(id) },
        platform: platform(db),
      } as never)) as { invites: { revoked_at: null | string }[] };
      const active = loaded.invites.filter((i) => i.revoked_at === null);
      expect(active).toHaveLength(1);
    });

    it("revokes an invite by id", async () => {
      const id = await newLeague(db, "private");
      await runCreate(base(String(id), OWNER.user, "u1") as never);
      const loaded = (await load({
        locals: { user: OWNER.user, userId: "u1" },
        params: { id: String(id) },
        platform: platform(db),
      } as never)) as { invites: { id: number }[] };
      const inviteId = loaded.invites[0]?.id ?? 0;

      const result = (await runRevoke({
        locals: { user: OWNER.user, userId: "u1" },
        params: { id: String(id) },
        platform: platform(db),
        request: formRequest({ inviteId: String(inviteId) }),
      } as never)) as { revoked: number };
      expect(result.revoked).toBe(inviteId);
    });

    it("404s a revoke of an unknown invite id", async () => {
      const id = await newLeague(db, "private");
      await expect(
        runRevoke({
          locals: { user: OWNER.user, userId: "u1" },
          params: { id: String(id) },
          platform: platform(db),
          request: formRequest({ inviteId: "9999" }),
        } as never),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
