import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { profileSchema, toDashboardUrl } from "./profile-schema";

function parse(input: { dashboard_url: string; visibility: string }) {
  return v.safeParse(profileSchema, input);
}

describe("profileSchema", () => {
  it("accepts public/private visibility with a valid https url", () => {
    const result = parse({
      dashboard_url: "https://dash.example.com",
      visibility: "public",
    });

    expect(result.success).toBe(true);
  });

  it("accepts an http url", () => {
    expect(
      // eslint-disable-next-line unicorn/prefer-https -- verifying http is accepted
      parse({ dashboard_url: "http://dash.example.com", visibility: "private" })
        .success,
    ).toBe(true);
  });

  it("rejects an unknown visibility value", () => {
    expect(parse({ dashboard_url: "", visibility: "secret" }).success).toBe(
      false,
    );
  });

  it("allows an empty dashboard url (clearable)", () => {
    expect(parse({ dashboard_url: "", visibility: "public" }).success).toBe(
      true,
    );
  });

  it("rejects a non-url string", () => {
    expect(
      parse({ dashboard_url: "not a url", visibility: "public" }).success,
    ).toBe(false);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(
      parse({ dashboard_url: "ftp://dash.example.com", visibility: "public" })
        .success,
    ).toBe(false);
  });

  it("rejects a url longer than 2048 characters", () => {
    const longUrl = `https://dash.example.com/${"a".repeat(2048)}`;
    expect(parse({ dashboard_url: longUrl, visibility: "public" }).success).toBe(
      false,
    );
  });

  it("trims surrounding whitespace before validating and storing", () => {
    const result = parse({
      dashboard_url: "  https://dash.example.com  ",
      visibility: "public",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.dashboard_url).toBe("https://dash.example.com");
    }
  });
});

describe("toDashboardUrl", () => {
  it("maps an empty string to null", () => {
    expect(toDashboardUrl("")).toBeNull();
  });

  it("passes a non-empty url through", () => {
    expect(toDashboardUrl("https://dash.example.com")).toBe(
      "https://dash.example.com",
    );
  });
});
