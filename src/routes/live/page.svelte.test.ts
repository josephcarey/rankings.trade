import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import Page from "./+page.svelte";

/** Minimal `PageData` shape the live page reads, with three agents. */
function makeData(defaultSymbols: string[]) {
  return {
    chart: null,
    defaultSymbols,
    observedAts: ["T1", "T2"],
    resetDate: "2026-06-07",
    rows: [
      {
        rank: 1,
        symbol: "LEADER",
        agent_id: null,
        display_name: null,
        credits: 2_000_000,
        credit_rank: 1,
        ship_count: 5,
      },
      {
        rank: 2,
        symbol: "MID",
        agent_id: null,
        display_name: null,
        credits: 200,
        credit_rank: 2,
        ship_count: 3,
      },
      {
        rank: 3,
        symbol: "LOW",
        agent_id: null,
        display_name: null,
        credits: 80,
        credit_rank: 3,
        ship_count: 1,
      },
    ],
    seriesBySymbol: {
      LEADER: [1_000_000, 2_000_000],
      MID: [100, 200],
      LOW: [50, 80],
    },
  };
}

// The page's `data` prop is the full merged `PageData` (incl. layout data); the
// component only reads the live-specific fields, so a focused mock is cast in.
function renderPage(defaultSymbols: string[]) {
  return render(Page, { data: makeData(defaultSymbols) as never });
}

function descMax(container: HTMLElement): null | string {
  return container.querySelector("desc")?.textContent ?? null;
}

describe("live page line selection", () => {
  it("plots only the default symbols on first paint", () => {
    const { container } = renderPage(["LEADER"]);
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
    expect(screen.getByText(/Plotting/)).toHaveTextContent(
      "Plotting 1 of 3 agents",
    );
  });

  it("adds a line when a row is ticked and removes it when unticked", async () => {
    const { container } = renderPage(["LEADER"]);

    const midToggle = screen.getByLabelText("Plot MID credit line");
    await fireEvent.click(midToggle);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);

    await fireEvent.click(midToggle);
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
  });

  it("All selects every agent and None clears the chart", async () => {
    const { container } = renderPage(["LEADER"]);

    await fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(container.querySelectorAll("polyline")).toHaveLength(3);

    await fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.getByText(/tick a row below/)).toBeInTheDocument();
  });

  it("rescales the y-axis when the runaway leader is deselected", async () => {
    const { container } = renderPage(["LEADER", "MID", "LOW"]);

    // With the leader plotted the value range reaches its 2,000,000 credits.
    expect(descMax(container)).toContain("2000000");

    await fireEvent.click(screen.getByLabelText("Plot LEADER credit line"));

    // Leader gone: the axis rescales to the remaining lines (MID peaks at 200).
    const desc = descMax(container);
    expect(desc).not.toContain("2000000");
    expect(desc).toContain("200");
  });

  it("filters the checkbox list by callsign", async () => {
    renderPage(["LEADER"]);

    expect(screen.getByLabelText("Plot MID credit line")).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText("Find an agent"), {
      target: { value: "lead" },
    });

    expect(
      screen.getByLabelText("Plot LEADER credit line"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Plot MID credit line"),
    ).not.toBeInTheDocument();
  });
});
