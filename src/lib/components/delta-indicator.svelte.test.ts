import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import DeltaIndicator from "./delta-indicator.svelte";

describe("delta-indicator direction logic", () => {
  it("shows an up arrow and magnitude when the delta is positive", () => {
    render(DeltaIndicator, { delta: 4, label: "Rank" });
    expect(screen.getByText("▲")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows a down arrow and the absolute magnitude when the delta is negative", () => {
    render(DeltaIndicator, { delta: -2, label: "Rating" });
    expect(screen.getByText("▼")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("-2")).not.toBeInTheDocument();
  });

  it("shows a neutral bar and no magnitude when the delta is zero", () => {
    render(DeltaIndicator, { delta: 0, label: "Rank" });
    expect(screen.getByText("▬")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders no directional arrow when the delta is null (new entrant)", () => {
    const { container } = render(DeltaIndicator, {
      delta: null,
      label: "Rank",
    });
    for (const arrow of ["▲", "▼", "▬"]) {
      expect(screen.queryByText(arrow)).not.toBeInTheDocument();
    }
    expect(container.querySelector(".delta-new")).toBeInTheDocument();
    expect(screen.getByText(/new this season/)).toBeInTheDocument();
  });

  it("applies a direction-specific class for colouring", () => {
    const up = render(DeltaIndicator, { delta: 1, label: "Rank" });
    expect(up.container.querySelector(".delta-up")).toBeInTheDocument();

    const down = render(DeltaIndicator, { delta: -1, label: "Rank" });
    expect(down.container.querySelector(".delta-down")).toBeInTheDocument();

    const flat = render(DeltaIndicator, { delta: 0, label: "Rank" });
    expect(flat.container.querySelector(".delta-flat")).toBeInTheDocument();
  });

  it("exposes a screen-reader description of the direction", () => {
    render(DeltaIndicator, { delta: 5, label: "Rank" });
    expect(
      screen.getByText(/Rank\s+up\s+5\s+since the previous round/),
    ).toBeInTheDocument();
  });
});
