import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

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
});
