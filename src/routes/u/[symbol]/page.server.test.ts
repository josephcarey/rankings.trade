import { fileURLToPath } from "node:url";
import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { addMember } from "../../../lib/db/league-members";
import { loadMigrations } from "../../../lib/db/loader";
import { runMigrations } from "../../../lib/db/migrate";
import { insertSeason } from "../../../lib/db/seasons";
import { createSqliteD1 } from "../../../lib/db/sqlite-d1-adapter";
import { load } from "./+page.server";

const migrationsDir = fileURLToPath(
  new URL("../../../../migrations", import.meta.url),
);

const OWNER = { user: { id: 1 }, userId: "u1" };
const STRANGER = { user: { id: 2 }, userId: "u2" };

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

function invoke(
  db: null | D1Database,
  symbol: string,
  who: { user: unknown; userId: string } | null = null,
) {
  return load({
    locals: { user: who?.user ?? null, userId: who?.userId ?? null },
    params: { symbol },
    platform: db ? platform(db) : undefined,
  } as never);
}

async function insertAgent(
  db: D1Database,
  symbol: string,
  ownerUserId: null | number,
): Promise<number> {
  const row = await db
    .prepare("INSERT INTO agents (symbol, owner_user_id) VALUES (?, ?) RETURNING id")
    .bind(symbol, ownerUserId)
    .first<{ id: number }>();
  return row!.id;
}

async function openSeason(db: D1Database): Promise<number> {
  const season = await insertSeason(db, {
    cutoff_date: "2027-01-01",
    label: "Season 2",
    unranked_gap_days: 0,
  });
  return season.id;
}

async function insertRating(
  db: D1Database,
  agentId: number,
  seasonId: number,
  rating: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ratings (agent_id, season_id, rating, rd, volatility)
       VALUES (?, ?, ?, 40, 0.06)`,
    )
    .bind(agentId, seasonId, rating)
    .run();
}

async function insertClosedSeasonHistory(
  db: D1Database,
  agentId: number,
): Promise<void> {
  const season = await db
    .prepare(
      `INSERT INTO seasons (label, cutoff_date, unranked_gap_days, closed_at)
       VALUES ('Season 1', '2025-01-01', 0, '2025-12-31T00:00:00Z') RETURNING id`,
    )
    .first<{ id: number }>();
  await db
    .prepare(
      `INSERT INTO season_standings
         (season_id, agent_id, final_rating, final_rd, final_volatility,
          final_rank, title, established, ranked_rounds)
       VALUES (?, ?, 1480, 50, 0.06, 4, 'Commander', 1, 12)`,
    )
    .bind(season!.id, agentId)
    .run();
}

async function insertLeague(
  db: D1Database,
  name: string,
  visibility: "private" | "public",
  ownerUserId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO leagues (name, visibility, owner_user_id)
       VALUES (?, ?, ?) RETURNING id`,
    )
    .bind(name, visibility, ownerUserId)
    .first<{ id: number }>();
  return row!.id;
}

async function insertMilestone(
  db: D1Database,
  agentId: number,
  type: string,
): Promise<void> {
  await db
    .prepare("INSERT INTO milestones (agent_id, type, ts) VALUES (?, ?, '2026-06-01T00:00:00Z')")
    .bind(agentId, type)
    .run();
}

describe("public profile page server load", () => {
  let db: D1Database;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("500s when the platform DB is unavailable", async () => {
    await expect(invoke(null, "ALFA")).rejects.toMatchObject({ status: 500 });
  });

  it("404s an unknown agent", async () => {
    await expect(invoke(db, "NOBODY")).rejects.toMatchObject({ status: 404 });
  });

  it("shows the open-season current standing and chart, scoped to that season", async () => {
    const seasonId = await openSeason(db);
    const agentId = await insertAgent(db, "ALFA", 1);
    await insertRating(db, agentId, seasonId, 1550);

    const round = await db
      .prepare(
        `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
         VALUES ('2026-06-01', ?, 1, '2026-06-01T00:00:00Z') RETURNING id`,
      )
      .bind(seasonId)
      .first<{ id: number }>();
    await db
      .prepare(
        `INSERT INTO round_standings
           (round_id, league_id, agent_symbol, agent_id, final_credits, final_rank, participated)
         VALUES (?, NULL, 'ALFA', ?, 800, 1, 1)`,
      )
      .bind(round!.id, agentId)
      .run();

    const result = (await invoke(db, "ALFA")) as {
      chart: { hasData: boolean };
      current: { rating: number } | null;
      seasonLabel: null | string;
    };
    expect(result.seasonLabel).toBe("Season 2");
    expect(result.current?.rating).toBe(1550);
    expect(result.chart.hasData).toBe(true);
  });

  it("builds the rating-over-time chart and the rank/rating delta from history", async () => {
    const seasonId = await openSeason(db);
    const agentId = await insertAgent(db, "ALFA", 1);
    await insertRating(db, agentId, seasonId, 1550);

    const r1 = await db
      .prepare(
        `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
         VALUES ('2026-06-01', ?, 1, '2026-06-01T00:00:00Z') RETURNING id`,
      )
      .bind(seasonId)
      .first<{ id: number }>();
    const r2 = await db
      .prepare(
        `INSERT INTO rounds (reset_date, season_id, is_ranked, finalized_at)
         VALUES ('2026-06-08', ?, 1, '2026-06-08T00:00:00Z') RETURNING id`,
      )
      .bind(seasonId)
      .first<{ id: number }>();
    await db
      .prepare(
        `INSERT INTO rating_history (agent_id, season_id, round_id, rating, rd, rank)
         VALUES (?, ?, ?, 1500, 60, 3)`,
      )
      .bind(agentId, seasonId, r1!.id)
      .run();
    await db
      .prepare(
        `INSERT INTO rating_history (agent_id, season_id, round_id, rating, rd, rank)
         VALUES (?, ?, ?, 1550, 50, 1)`,
      )
      .bind(agentId, seasonId, r2!.id)
      .run();

    const result = (await invoke(db, "ALFA")) as {
      delta: { rankDelta: number; ratingDelta: number } | null;
      ratingChart: { hasData: boolean };
    };
    expect(result.ratingChart.hasData).toBe(true);
    expect(result.delta).toEqual({ ratingDelta: 50, rankDelta: 2 });
  });

  it("has no rating chart data and a null delta when there is no history", async () => {
    const seasonId = await openSeason(db);
    const agentId = await insertAgent(db, "ALFA", 1);
    await insertRating(db, agentId, seasonId, 1550);

    const result = (await invoke(db, "ALFA")) as {
      delta: unknown;
      ratingChart: { hasData: boolean };
    };
    expect(result.ratingChart.hasData).toBe(false);
    expect(result.delta).toBeNull();
  });

  it("shows no current standing when no season is open, but still lists archived history", async () => {
    const agentId = await insertAgent(db, "ALFA", 1);
    await insertClosedSeasonHistory(db, agentId);

    const result = (await invoke(db, "ALFA")) as {
      current: unknown;
      history: { seasonLabel: string; title: null | string }[];
      seasonLabel: null | string;
    };
    expect(result.current).toBeNull();
    expect(result.seasonLabel).toBeNull();
    expect(result.history).toHaveLength(1);
    expect(result.history[0]?.title).toBe("Commander");
    expect(result.history[0]?.seasonLabel).toBe("Season 1");
  });

  it("reveals a private league to the agent owner but hides it from a stranger", async () => {
    const agentId = await insertAgent(db, "ALFA", 1);
    const publicLeague = await insertLeague(db, "Public L", "public", 9);
    const privateLeague = await insertLeague(db, "Private L", "private", 9);
    await addMember(db, { agent_id: agentId, league_id: publicLeague });
    await addMember(db, { agent_id: agentId, league_id: privateLeague });

    const asOwner = (await invoke(db, "ALFA", OWNER)) as {
      leagues: { name: string }[];
    };
    expect(asOwner.leagues.map((l) => l.name).toSorted()).toEqual([
      "Private L",
      "Public L",
    ]);

    const asStranger = (await invoke(db, "ALFA", STRANGER)) as {
      leagues: { name: string }[];
    };
    expect(asStranger.leagues.map((l) => l.name)).toEqual(["Public L"]);
  });

  it("does not leak a private league's custom milestone label to a stranger", async () => {
    const agentId = await insertAgent(db, "ALFA", 1);
    const privateLeague = await insertLeague(db, "Private L", "private", 9);
    await addMember(db, { agent_id: agentId, league_id: privateLeague });
    await db
      .prepare(
        "INSERT INTO milestone_types (key, label, league_id) VALUES ('secret_badge', 'Secret Badge', ?)",
      )
      .bind(privateLeague)
      .run();
    await insertMilestone(db, agentId, "secret_badge");

    const asOwner = (await invoke(db, "ALFA", OWNER)) as {
      milestones: { label: string; recognized: boolean }[];
    };
    expect(asOwner.milestones[0]).toMatchObject({
      label: "Secret Badge",
      recognized: true,
    });

    const asStranger = (await invoke(db, "ALFA", STRANGER)) as {
      milestones: { label: string; recognized: boolean }[];
    };
    expect(asStranger.milestones[0]).toMatchObject({
      label: "Secret badge",
      recognized: false,
    });
  });

  it("gates canManage on real ownership", async () => {
    await insertAgent(db, "ALFA", 1);
    expect(((await invoke(db, "ALFA", OWNER)) as { canManage: boolean }).canManage).toBe(true);
    expect(
      ((await invoke(db, "ALFA", STRANGER)) as { canManage: boolean }).canManage,
    ).toBe(false);
    expect(((await invoke(db, "ALFA")) as { canManage: boolean }).canManage).toBe(false);
  });
});
