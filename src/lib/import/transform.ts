/**
 * Pure legacy → rankings.trade snapshot transform (Epic K).
 *
 * Maps a raw {@link LegacySnapshotRow} onto the current `snapshots` contract
 * ({@link AgentSnapshotRow}, migrations/0010_snapshots.sql). This is the ONLY place the
 * legacy shape is reconciled with the destination; it is a pure function so the mapping
 * rules are unit-testable in isolation and the import stays deterministic.
 *
 * Rules (see migrations/0010_snapshots.sql's header — net-worth and the chart leaderboard
 * columns were intentionally dropped when the scrape was ported):
 *   - DROP `net_worth` (historical estimate) and `chart_count`/`chart_rank` (chart board).
 *   - KEEP `credits` (the sole ranking metric), `credit_rank`, `ship_count`, `total_agents`.
 *   - `faction` is absent from the legacy export ⇒ defaults to `""` (unknown), unless a later
 *     export already carried it.
 *   - NORMALISE `agent_symbol` to the canonical UPPER form so it matches `agents.symbol`
 *     (which is stored UPPER); finalization left-joins `agents` on this symbol to attach
 *     `agent_id`, so a case mismatch would silently leave a registered agent unrated.
 *   - A row whose `credits` is null/non-finite is DROPPED (and reported): a final standing is
 *     ranked by credits, and an agent observed with unknown credits cannot be ranked. The
 *     other numerics coerce a missing value to 0 (faithful enough — credits is the metric).
 *
 * The drop set is reported so the dry-run can surface exactly what was discarded.
 */

import type { AgentSnapshotRow } from "../db/snapshots-types";
import type { LegacySnapshotRow } from "./legacy-types";

import { normalizeSymbol } from "../db/agents";

/** The result of transforming a batch of legacy rows. */
export interface TransformResult {
  /** Rows ready to upsert via {@link import("../db/snapshots").writeSnapshots}. */
  rows: AgentSnapshotRow[];
  /** Legacy rows discarded because `credits` was null/non-finite (kept for the report). */
  dropped: LegacySnapshotRow[];
}

/** Coerce a possibly-null numeric to a finite integer, or null when not finite. */
function intOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * Transform one legacy row, or return null when it must be dropped (unknown credits).
 *
 * @param row A raw legacy snapshot row.
 * @returns The mapped {@link AgentSnapshotRow}, or null if the row is dropped.
 */
export function transformRow(row: LegacySnapshotRow): AgentSnapshotRow | null {
  const credits = intOrNull(row.credits);
  if (credits === null) return null;

  return {
    reset_date: row.reset_date,
    observed_at: row.observed_at,
    agent_symbol: normalizeSymbol(row.agent_symbol),
    credits,
    credit_rank: intOrNull(row.credit_rank) ?? 0,
    total_agents: intOrNull(row.total_agents) ?? 0,
    ship_count: intOrNull(row.ship_count) ?? 0,
    faction: row.faction ?? "",
  };
}

/**
 * Transform a batch of legacy rows into destination snapshot rows, partitioning the input
 * into kept (`rows`) and discarded (`dropped`). Order is preserved so the output is a
 * deterministic function of the input order.
 *
 * @param legacy Raw legacy snapshot rows.
 */
export function transformSnapshots(
  legacy: readonly LegacySnapshotRow[],
): TransformResult {
  const rows: AgentSnapshotRow[] = [];
  const dropped: LegacySnapshotRow[] = [];
  for (const row of legacy) {
    const mapped = transformRow(row);
    if (mapped === null) dropped.push(row);
    else rows.push(mapped);
  }
  return { rows, dropped };
}
