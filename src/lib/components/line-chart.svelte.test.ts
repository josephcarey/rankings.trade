import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import { buildLineChart } from "../charts/line-chart";
import LineChart from "./line-chart.svelte";

const singleSeries = buildLineChart(
  ["2026-01-01", "2026-01-08", "2026-01-15"],
  [{ label: "Rating", values: [1500, 1520, 1495] }],
);

const multiSeries = buildLineChart(
  ["2026-01-01", "2026-01-08"],
  [
    { label: "ALPHA", values: [100, 200] },
    { label: "BETA", values: [150, 120] },
  ],
);

const emptyChart = buildLineChart([], []);

describe("line-chart", () => {
  it("renders an accessible SVG with a title and data description when there is data", () => {
    const { container } = render(LineChart, {
      caption: "Rating over time",
      chart: singleSeries,
    });

    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(container.querySelector("title")?.textContent).toBe(
      "Rating over time",
    );

    // Non-visual data alternative: the <desc> summarises series and value range.
    const desc = container.querySelector("desc");
    expect(desc?.textContent).toContain("Rating");
    expect(desc?.textContent).toContain("1495");
    expect(desc?.textContent).toContain("1520");

    // aria wiring points at the title and description.
    expect(svg).toHaveAttribute(
      "aria-labelledby",
      container.querySelector("title")?.id,
    );
    expect(svg).toHaveAttribute(
      "aria-describedby",
      container.querySelector("desc")?.id,
    );
  });

  it("draws one polyline per multi-point series", () => {
    const { container } = render(LineChart, { chart: multiSeries });
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("shows a per-series legend only when the legend prop is set", () => {
    const withLegend = render(LineChart, { chart: multiSeries, legend: true });
    expect(withLegend.container.querySelector(".legend")).toBeInTheDocument();
    expect(withLegend.getByText("ALPHA")).toBeInTheDocument();
    expect(withLegend.getByText("BETA")).toBeInTheDocument();

    const noLegend = render(LineChart, { chart: multiSeries, legend: false });
    expect(noLegend.container.querySelector(".legend")).not.toBeInTheDocument();
  });

  it("renders the empty message instead of an SVG when there is no data", () => {
    const { container } = render(LineChart, {
      chart: emptyChart,
      emptyText: "No rating history yet.",
    });
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.getByText("No rating history yet.")).toBeInTheDocument();
  });
});
