import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { listLeaguesByOwner } from "../../lib/db/leagues";
import { loadMigrations } from "../../lib/db/loader";
import { runMigrations } from "../../lib/db/migrate";
import { createSqliteD1 } from "../../lib/db/sqlite-d1-adapter";
import { actions, load } from "./+page.server";

const migrationsDir = fileURLToPath(new URL("../../../migrations", import.meta.url));

const USER = { clerk_user_id: "u1", id: 1 };

async function makeDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

function formRequest(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://app.test/leagues", { body, method: "POST" });
}

function platform(db: D1Database) {
  return { env: { ADMIN_CLERK_USER_IDS: "", DB: db } };
}

describe("leagues page server", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  describe("load", () => {
    it("returns an empty form and the caller's owned leagues", async () => {
      await db
        .prepare("INSERT INTO leagues (name, owner_user_id) VALUES (?, ?)")
        .bind("Mine", 1)
        .run();
      await db
        .prepare("INSERT INTO leagues (name, owner_user_id) VALUES (?, ?)")
        .bind("Theirs", 2)
        .run();

      const result = (await load({
        locals: { user: USER },
        platform: platform(db),
      } as never)) as { form: { data: unknown }; leagues: { name: string }[] };

      expect(result.leagues.map((l) => l.name)).toEqual(["Mine"]);
    });

    it("redirects an anonymous caller to sign-in", async () => {
      await expect(
        load({ locals: { user: null }, platform: platform(db) } as never),
      ).rejects.toMatchObject({
        location: "/sign-in?redirect_url=%2Fleagues",
        status: 302,
      });
    });
  });

  describe("create action", () => {
    const runAction = actions.default as NonNullable<typeof actions.default>;

    function invoke(fields: Record<string, string>, user: unknown = USER) {
      return runAction({
        locals: { user, userId: "u1" },
        platform: platform(db),
        request: formRequest(fields),
      } as never);
    }

    it("creates a private league and redirects to its detail page", async () => {
      await expect(
        invoke({ name: "Cool League", visibility: "private" }),
      ).rejects.toMatchObject({ status: 303 });

      const leagues = await listLeaguesByOwner(db, 1);
      expect(leagues).toHaveLength(1);
      expect(leagues[0]?.name).toBe("Cool League");
      expect(leagues[0]?.visibility).toBe("private");
    });

    it("rejects a blank name with a 400", async () => {
      const result = (await invoke({ name: "  " })) as {
        data: { form: { valid: boolean } };
        status: number;
      };
      expect(result.status).toBe(400);
      expect(result.data.form.valid).toBe(false);
    });

    it("returns 401 when there is no resolved actor", async () => {
      const result = (await invoke({ name: "Anon" }, null)) as { status: number };
      expect(result.status).toBe(401);
    });
  });
});
