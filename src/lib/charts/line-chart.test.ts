import { describe, expect, it } from "vitest";

import { buildLineChart } from "./line-chart";

const X = ["r1", "r2", "r3"];

describe("buildLineChart", () => {
  it("flags hasData false for no series", () => {
    const model = buildLineChart(X, []);
    expect(model.hasData).toBe(false);
    expect(model.series).toHaveLength(0);
  });

  it("flags hasData false when every value is null", () => {
    const model = buildLineChart(X, [{ label: "A", values: [null, null, null] }]);
    expect(model.hasData).toBe(false);
  });

  it("flags hasData false when there are no x columns", () => {
    const model = buildLineChart([], [{ label: "A", values: [] }]);
    expect(model.hasData).toBe(false);
  });

  it("builds a single polyline segment for a fully-populated series", () => {
    const model = buildLineChart(X, [{ label: "A", values: [10, 20, 30] }]);
    expect(model.hasData).toBe(true);
    expect(model.yMin).toBe(10);
    expect(model.yMax).toBe(30);
    const [series] = model.series;
    expect(series?.segments).toHaveLength(1);
    expect(series?.dots).toHaveLength(0);
    // three "x,y" pairs
    expect(series?.segments[0]?.split(" ")).toHaveLength(3);
  });

  it("splits a series into segments around null gaps", () => {
    // values: point, gap, two-point run
    const model = buildLineChart(["a", "b", "c", "d"], [
      { label: "A", values: [5, null, 7, 9] },
    ]);
    const [series] = model.series;
    // the lone leading value becomes a dot; the trailing pair becomes a segment
    expect(series?.dots).toHaveLength(1);
    expect(series?.segments).toHaveLength(1);
    expect(series?.segments[0]?.split(" ")).toHaveLength(2);
  });

  it("inverts the y-axis so larger values sit higher (smaller y)", () => {
    const model = buildLineChart(["a", "b"], [{ label: "A", values: [0, 100] }]);
    const pts = model.series[0]?.segments[0]?.split(" ") ?? [];
    const y0 = Number(pts[0]?.split(",", 2)[1]);
    const y1 = Number(pts[1]?.split(",", 2)[1]);
    expect(y1).toBeLessThan(y0);
  });

  it("pins points to the mid-line when the value range is flat", () => {
    const model = buildLineChart(["a", "b"], [{ label: "A", values: [42, 42] }]);
    const pts = model.series[0]?.segments[0]?.split(" ") ?? [];
    const ys = pts.map((p) => Number(p.split(",", 2)[1]));
    expect(new Set(ys)).toEqual(new Set([model.height / 2]));
  });

  it("centres a single x-column horizontally", () => {
    const model = buildLineChart(["only"], [{ label: "A", values: [5] }]);
    expect(model.series[0]?.dots[0]?.x).toBe(model.width / 2);
  });

  it("honours custom viewBox dimensions", () => {
    const model = buildLineChart(X, [{ label: "A", values: [1, 2, 3] }], {
      height: 100,
      width: 300,
    });
    expect(model.width).toBe(300);
    expect(model.height).toBe(100);
  });

  it("treats non-finite numbers as gaps", () => {
    const model = buildLineChart(["a", "b", "c"], [
      { label: "A", values: [1, Number.NaN, 3] },
    ]);
    expect(model.series[0]?.dots).toHaveLength(2);
    expect(model.series[0]?.segments).toHaveLength(0);
  });
});
