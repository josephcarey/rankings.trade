/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { loadMigrations } from "../../../lib/db/loader";
import { runMigrations } from "../../../lib/db/migrate";
import { getOpenSeason } from "../../../lib/db/seasons";
import { createSqliteD1 } from "../../../lib/db/sqlite-d1-adapter";
import { actions, load } from "./+page.server";

const migrationsDir = fileURLToPath(new URL("../../../../migrations", import.meta.url));
const ADMIN_ENV = "user_admin";

async function freshDb(): Promise<D1Database> {
  const SQL = await Database();
  const db = createSqliteD1(new SQL.Database());
  const result = await runMigrations(db, await loadMigrations(migrationsDir));
  expect(result.success).toBe(true);
  return db;
}

function formRequest(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://app.test/admin/seasons", { body, method: "POST" });
}

describe("admin seasons page server", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  function ctx(extra: Record<string, unknown> = {}, clerkUserId: string | null = "user_admin") {
    return {
      locals: { userId: clerkUserId },
      platform: { env: { ADMIN_CLERK_USER_IDS: ADMIN_ENV, DB: db } },
      ...extra,
    } as never;
  }

  const create = actions.create as NonNullable<typeof actions.create>;
  const update = actions.update as NonNullable<typeof actions.update>;

  describe("load", () => {
    it("returns the season list for an admin", async () => {
      const result: any = await load(ctx());
      expect(result.seasons).toEqual([]);
    });

    it("returns 404 for a non-admin", async () => {
      await expect(load(ctx({}, "user_alice"))).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("create action", () => {
    it("opens a season for an admin", async () => {
      const result: any = await create(
        ctx({ request: formRequest({ label: "S1", cutoff_date: "2026-09-01", unranked_gap_days: "5" }) }),
      );
      expect(result.created.label).toBe("S1");
      expect((await getOpenSeason(db))!.unranked_gap_days).toBe(5);
    });

    it("returns 403 for a non-admin", async () => {
      await expect(
        create(ctx({ request: formRequest({ label: "S1", cutoff_date: "2026-09-01" }) }, "user_alice")),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("fails when a season is already open", async () => {
      await create(ctx({ request: formRequest({ label: "S1", cutoff_date: "2026-09-01" }) }));
      const result: any = await create(
        ctx({ request: formRequest({ label: "S2", cutoff_date: "2026-10-01" }) }),
      );
      expect(result.status).toBe(409);
      expect(result.data.error).toBeTruthy();
    });

    it("fails on an invalid cutoff", async () => {
      const result: any = await create(
        ctx({ request: formRequest({ label: "S1", cutoff_date: "nope" }) }),
      );
      expect(result.status).toBe(400);
    });
  });

  describe("update action", () => {
    it("updates the open season", async () => {
      const created: any = await create(
        ctx({ request: formRequest({ label: "S1", cutoff_date: "2026-09-01" }) }),
      );
      const result: any = await update(
        ctx({
          request: formRequest({
            id: String(created.created.id),
            cutoff_date: "2026-09-20",
            unranked_gap_days: "2",
          }),
        }),
      );
      expect(result.updated.id).toBe(created.created.id);
      expect((await getOpenSeason(db))!.cutoff_date).toBe("2026-09-20");
    });

    it("returns 403 for a non-admin", async () => {
      await expect(
        update(ctx({ request: formRequest({ id: "1", unranked_gap_days: "1" }) }, "user_alice")),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("fails with 404 for an unknown season", async () => {
      const result: any = await update(
        ctx({ request: formRequest({ id: "999", unranked_gap_days: "1" }) }),
      );
      expect(result.status).toBe(404);
    });
  });
});
