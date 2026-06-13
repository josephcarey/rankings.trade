import Database from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { createSqliteD1 } from "./sqlite-d1-adapter";

let db: D1Database;

beforeEach(async () => {
  const SQL = await Database();
  const raw = new SQL.Database();
  raw.run("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL UNIQUE)");
  db = createSqliteD1(raw);
});

describe("SqliteD1Database.batch — atomicity (§7.4)", () => {
  it("commits every statement when all succeed", async () => {
    await db.batch([
      db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(1, "a"),
      db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(2, "b"),
    ]);

    const { results } = await db
      .prepare("SELECT id FROM t ORDER BY id")
      .all<{ id: number }>();
    expect(results.map((r) => r.id)).toEqual([1, 2]);
  });

  it("rolls back the whole batch when a later statement fails", async () => {
    // Seed a row whose `v` the batch's second statement will collide with.
    await db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(10, "dup").run();

    await expect(
      db.batch([
        db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(11, "fresh"),
        db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(12, "dup"), // UNIQUE violation
      ]),
    ).rejects.toThrow();

    // The pre-failure insert (id 11) must NOT have persisted — real D1 batch() is atomic.
    const { results } = await db
      .prepare("SELECT id FROM t ORDER BY id")
      .all<{ id: number }>();
    expect(results.map((r) => r.id)).toEqual([10]);
  });

  it("leaves the connection usable after a rolled-back batch", async () => {
    await db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(1, "x").run();

    await expect(
      db.batch([db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(2, "x")]),
    ).rejects.toThrow();

    // A subsequent write still works (the savepoint was released, not left open).
    await db.prepare("INSERT INTO t (id, v) VALUES (?, ?)").bind(3, "y").run();
    const { results } = await db
      .prepare("SELECT id FROM t ORDER BY id")
      .all<{ id: number }>();
    expect(results.map((r) => r.id)).toEqual([1, 3]);
  });
});
