import { describe, expect, it } from "vitest";

import {
  isValidMilestoneType,
  LOG_TEXT_MAX,
  METADATA_MAX_BYTES,
  METADATA_MAX_DEPTH,
  MILESTONE_TYPE_MAX,
  normalizeMilestoneType,
  validateLogText,
  validateMetadata,
  validateMilestoneType,
} from "./validation";

describe("normalizeMilestoneType", () => {
  it("trims and lowercases", () => {
    expect(normalizeMilestoneType("  First-Jump  ")).toBe("first-jump");
  });
});

describe("isValidMilestoneType", () => {
  it.each(["first-jump", "credits-10m", "a", "x9", "system-charted"])(
    "accepts %j",
    (key) => expect(isValidMilestoneType(key)).toBe(true),
  );

  it.each(["", "-leading", "Has Space", "UPPER", "emoji-🚀", "under_score"])(
    "rejects %j",
    (key) => expect(isValidMilestoneType(key)).toBe(false),
  );

  it("rejects a key longer than the bound", () => {
    expect(isValidMilestoneType("a".repeat(MILESTONE_TYPE_MAX + 1))).toBe(false);
  });
});

describe("validateLogText", () => {
  it("accepts and trims a normal line", () => {
    expect(validateLogText("  hello world  ")).toEqual({
      ok: true,
      value: "hello world",
    });
  });

  it.each([null, undefined, 42, "", ' '.repeat(3)])("rejects %j", (raw) => {
    expect(validateLogText(raw)).toEqual({ ok: false, reason: "invalid_text" });
  });

  it("rejects an overlong line", () => {
    expect(validateLogText("a".repeat(LOG_TEXT_MAX + 1))).toEqual({
      ok: false,
      reason: "invalid_text",
    });
  });

  it("accepts a line exactly at the max", () => {
    const result = validateLogText("a".repeat(LOG_TEXT_MAX));
    expect(result.ok).toBe(true);
  });
});

describe("validateMilestoneType", () => {
  it("normalizes then accepts a well-formed unknown type (tolerant)", () => {
    expect(validateMilestoneType("  Warp-Core-Online ")).toEqual({
      ok: true,
      value: "warp-core-online",
    });
  });

  it.each([null, 42, "", ' '.repeat(3), "has space", "bad_key"])(
    "rejects malformed %j",
    (raw) => {
      expect(validateMilestoneType(raw)).toEqual({
        ok: false,
        reason: "invalid_type",
      });
    },
  );
});

describe("validateMetadata", () => {
  it("treats null/undefined as a stored NULL", () => {
    expect(validateMetadata(null)).toEqual({ ok: true, value: null });
    expect(validateMetadata()).toEqual({ ok: true, value: null });
  });

  it("serializes a plain object canonically", () => {
    expect(validateMetadata({ credits: 1_000_000, ship: "frigate" })).toEqual({
      ok: true,
      value: '{"credits":1000000,"ship":"frigate"}',
    });
  });

  it.each([42, "string", true])("rejects primitive %j", (raw) => {
    expect(validateMetadata(raw)).toEqual({
      ok: false,
      reason: "invalid_metadata",
    });
  });

  it("rejects an array", () => {
    expect(validateMetadata([1, 2, 3])).toEqual({
      ok: false,
      reason: "invalid_metadata",
    });
  });

  it("rejects metadata over the byte cap", () => {
    const big = { blob: "x".repeat(METADATA_MAX_BYTES) };
    expect(validateMetadata(big)).toEqual({
      ok: false,
      reason: "invalid_metadata",
    });
  });

  it("rejects metadata nested beyond the depth cap", () => {
    let nested: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < METADATA_MAX_DEPTH + 1; i++) nested = { nested };
    expect(validateMetadata(nested)).toEqual({
      ok: false,
      reason: "invalid_metadata",
    });
  });

  it("accepts metadata at the depth cap", () => {
    let nested: Record<string, unknown> = { v: 1 };
    // depth of {v:1} is 1; wrap to reach exactly METADATA_MAX_DEPTH.
    for (let i = 0; i < METADATA_MAX_DEPTH - 1; i++) nested = { nested };
    expect(validateMetadata(nested).ok).toBe(true);
  });
});
