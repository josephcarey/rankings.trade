import { describe, expect, it } from "vitest";

import {
  describeMilestone,
  humanizeType,
  parseMetadataFields,
} from "./milestone";

describe("humanizeType", () => {
  it("title-cases an underscore/dash slug", () => {
    expect(humanizeType("first_million")).toBe("First million");
    expect(humanizeType("hit-the-cap")).toBe("Hit the cap");
  });

  it("returns the raw type when there is nothing to humanize", () => {
    expect(humanizeType("___")).toBe("___");
  });
});

describe("parseMetadataFields", () => {
  it("returns [] for null or blank metadata", () => {
    expect(parseMetadataFields(null)).toEqual([]);
    expect(parseMetadataFields("  ")).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseMetadataFields("{not json")).toEqual([]);
  });

  it("returns [] for non-object JSON (array/scalar)", () => {
    expect(parseMetadataFields("[1,2,3]")).toEqual([]);
    expect(parseMetadataFields("42")).toEqual([]);
  });

  it("flattens scalar fields to strings", () => {
    const fields = parseMetadataFields(
      JSON.stringify({ amount: 1_000_000, flag: true, name: "Zorp" }),
    );
    expect(fields).toEqual([
      { key: "amount", value: "1000000" },
      { key: "flag", value: "true" },
      { key: "name", value: "Zorp" },
    ]);
  });

  it("JSON-stringifies nested values", () => {
    const fields = parseMetadataFields(JSON.stringify({ at: { x: 1 } }));
    expect(fields).toEqual([{ key: "at", value: '{"x":1}' }]);
  });
});

describe("describeMilestone", () => {
  const base = { metadata: null, ts: "2026-01-01T00:00:00Z" };

  it("marks a recognized type and prefers its custom label", () => {
    const recognized = new Map([["first_million", "First Million 🎉"]]);
    const view = describeMilestone({ ...base, type: "first_million" }, recognized);
    expect(view.recognized).toBe(true);
    expect(view.label).toBe("First Million 🎉");
  });

  it("recognizes a type with no custom label, falling back to the humanized type", () => {
    const recognized = new Map<string, null | string>([["max_rank", null]]);
    const view = describeMilestone({ ...base, type: "max_rank" }, recognized);
    expect(view.recognized).toBe(true);
    expect(view.label).toBe("Max rank");
  });

  it("marks an unrecognized type generic with a humanized label", () => {
    const view = describeMilestone(
      { ...base, type: "secret_sauce" },
      new Map(),
    );
    expect(view.recognized).toBe(false);
    expect(view.label).toBe("Secret sauce");
  });

  it("includes parsed metadata fields", () => {
    const view = describeMilestone(
      { ...base, metadata: JSON.stringify({ credits: 5 }), type: "x" },
      new Map(),
    );
    expect(view.fields).toEqual([{ key: "credits", value: "5" }]);
  });
});
