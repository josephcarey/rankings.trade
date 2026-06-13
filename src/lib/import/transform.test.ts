import { describe, expect, it } from "vitest";

import type { LegacySnapshotRow } from "./legacy-types";

import { transformRow, transformSnapshots } from "./transform";

const base: LegacySnapshotRow = {
  reset_date: "2024-11-01",
  observed_at: "2024-11-01T00:00",
  agent_symbol: "bames_jond",
  credits: 1000,
  credit_rank: 1,
  total_agents: 3,
  ship_count: 2,
  chart_count: 5,
  chart_rank: 2,
  net_worth: 1234,
};

describe("transformRow", () => {
  it("maps the kept columns and drops net-worth + chart columns", () => {
    const out = transformRow(base)!;
    expect(out).toEqual({
      reset_date: "2024-11-01",
      observed_at: "2024-11-01T00:00",
      agent_symbol: "BAMES_JOND",
      credits: 1000,
      credit_rank: 1,
      total_agents: 3,
      ship_count: 2,
      faction: "",
    });
    expect(out).not.toHaveProperty("chart_count");
    expect(out).not.toHaveProperty("net_worth");
  });

  it("normalises the agent symbol to canonical UPPER form (so the agents join matches)", () => {
    expect(transformRow({ ...base, agent_symbol: "  s41n7-ii " })!.agent_symbol).toBe(
      "S41N7-II",
    );
  });

  it("preserves an already-present faction column", () => {
    expect(transformRow({ ...base, faction: "COSMIC" })!.faction).toBe("COSMIC");
  });

  it("drops a row whose credits are null or non-finite", () => {
    expect(transformRow({ ...base, credits: null })).toBeNull();
    expect(transformRow({ ...base, credits: Number.NaN })).toBeNull();
  });

  it("coerces missing secondary numerics to 0 and truncates floats", () => {
    const out = transformRow({
      ...base,
      credits: 10.9,
      credit_rank: null,
      total_agents: null,
      ship_count: null,
    })!;
    expect(out).toMatchObject({ credits: 10, credit_rank: 0, total_agents: 0, ship_count: 0 });
  });
});

describe("transformSnapshots", () => {
  it("partitions rows into kept and dropped, preserving order", () => {
    const { rows, dropped } = transformSnapshots([
      base,
      { ...base, agent_symbol: "GHOST", credits: null },
      { ...base, agent_symbol: "JBARHORST" },
    ]);
    expect(rows.map((r) => r.agent_symbol)).toEqual(["BAMES_JOND", "JBARHORST"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.agent_symbol).toBe("GHOST");
  });
});
