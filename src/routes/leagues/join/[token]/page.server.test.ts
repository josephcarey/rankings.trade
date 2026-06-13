import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "../../../../lib/db/loader";
import { runMigrations } from "../../../../lib/db/migrate";
import { createSqliteD1 } from "../../../../lib/db/sqlite-d1-adapter";
import { createLeagueForActor, createLeagueInvite } from "../../../../lib/leagues/league-service";
import { actions, load } from "./+page.server";

const migrationsDir = fileURLToPath(
  new URL("../../../../../migrations", import.meta.url),
);

const OWNER = { isAdmin: false, userId: 1 };

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

/** Create a private league with one invite; return its id and join token. */
async function leagueWithInvite(
  db: D1Database,
): Promise<{ id: number; token: string }> {
  const league = await createLeagueForActor(db, OWNER, {
    name: "League",
    visibility: "private",
  });
  if (!league.ok) throw new Error("setup failed");
  const invite = await createLeagueInvite(db, OWNER, league.value.id);
  if (!invite.ok) throw new Error("setup failed");
  return { id: league.value.id, token: invite.value.token };
}

function formRequest(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://app.test/leagues/join/t", { body, method: "POST" });
}

describe("league join page server", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  describe("load", () => {
    it("shows the league name and sign-in prompt to an anonymous visitor", async () => {
      const { token } = await leagueWithInvite(db);
      const result = (await load({
        locals: { user: null },
        params: { token },
        platform: platform(db),
      } as never)) as {
        agents: unknown[];
        leagueName: null | string;
        signedIn: boolean;
        valid: boolean;
      };
      expect(result.valid).toBe(true);
      expect(result.leagueName).toBe("League");
      expect(result.signedIn).toBe(false);
      expect(result.agents).toEqual([]);
    });

    it("marks an unknown token as invalid", async () => {
      const result = (await load({
        locals: { user: null },
        params: { token: "rtlnk_nope" },
        platform: platform(db),
      } as never)) as { leagueName: null | string; valid: boolean };
      expect(result.valid).toBe(false);
      expect(result.leagueName).toBeNull();
    });

    it("lists the signed-in caller's agents to pick from", async () => {
      const { token } = await leagueWithInvite(db);
      await insertAgent(db, "MINE", 7);
      const result = (await load({
        locals: { user: { id: 7 } },
        params: { token },
        platform: platform(db),
      } as never)) as { agents: { symbol: string }[]; signedIn: boolean };
      expect(result.signedIn).toBe(true);
      expect(result.agents.map((a) => a.symbol)).toEqual(["MINE"]);
    });
  });

  describe("accept action", () => {
    const runAccept = actions.default as NonNullable<typeof actions.default>;

    function invoke(
      token: string,
      fields: Record<string, string>,
      user: unknown,
      userId: null | string = null,
    ) {
      return runAccept({
        locals: { user, userId },
        params: { token },
        platform: platform(db),
        request: formRequest(fields),
      } as never);
    }

    it("joins the chosen owned agent and redirects to the league", async () => {
      const { id, token } = await leagueWithInvite(db);
      const agentId = await insertAgent(db, "MINE", 7);
      await expect(
        invoke(token, { agentId: String(agentId) }, { id: 7 }, "u7"),
      ).rejects.toMatchObject({ location: `/leagues/${id}`, status: 303 });
    });

    it("redirects an anonymous accept to sign-in", async () => {
      const { token } = await leagueWithInvite(db);
      await expect(
        invoke(token, { agentId: "1" }, null),
      ).rejects.toMatchObject({ status: 302 });
    });

    it("rejects a missing agent selection", async () => {
      const { token } = await leagueWithInvite(db);
      const result = (await invoke(token, { agentId: "" }, { id: 7 }, "u7")) as {
        data: { error: string };
        status: number;
      };
      expect(result.status).toBe(400);
      expect(result.data.error).toMatch(/choose an agent/i);
    });

    it("rejects an invalid token", async () => {
      const agentId = await insertAgent(db, "MINE", 7);
      const result = (await invoke(
        "rtlnk_nope",
        { agentId: String(agentId) },
        { id: 7 },
        "u7",
      )) as { data: { error: string }; status: number };
      expect(result.status).toBe(400);
      expect(result.data.error).toMatch(/invalid or has been revoked/i);
    });

    it("rejects joining with an agent the caller does not own", async () => {
      const { token } = await leagueWithInvite(db);
      const agentId = await insertAgent(db, "THEIRS", 99);
      const result = (await invoke(
        token,
        { agentId: String(agentId) },
        { id: 7 },
        "u7",
      )) as { data: { error: string }; status: number };
      expect(result.status).toBe(400);
      expect(result.data.error).toMatch(/agent you own/i);
    });
  });
});
