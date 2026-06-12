import { describe, expect, it } from "vitest";

import { generateToken, hashToken, tokenPrefix } from "./token";

describe("generateToken", () => {
  it("produces an rtbot_-scheme token with a 64-hex SHA-256 hash", async () => {
    const { token, hash, prefix } = await generateToken();
    expect(token.startsWith("rtbot_")).toBe(true);
    expect(token.length).toBeGreaterThan("rtbot_".length + 30);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.startsWith(prefix)).toBe(true);
  });

  it("returns a hash consistent with hashToken(token)", async () => {
    const { token, hash } = await generateToken();
    expect(await hashToken(token)).toBe(hash);
  });

  it("generates unique tokens and hashes across many calls", async () => {
    const tokens = new Set<string>();
    const hashes = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const generated = await generateToken();
      tokens.add(generated.token);
      hashes.add(generated.hash);
    }
    expect(tokens.size).toBe(200);
    expect(hashes.size).toBe(200);
  });
});

describe("hashToken", () => {
  it("is stable for equal input", async () => {
    expect(await hashToken("rtbot_example")).toBe(await hashToken("rtbot_example"));
  });

  it("differs for different input", async () => {
    expect(await hashToken("rtbot_a")).not.toBe(await hashToken("rtbot_b"));
  });
});

describe("tokenPrefix", () => {
  it("returns the scheme plus the first six body characters", () => {
    expect(tokenPrefix("rtbot_ABCDEFGHIJ")).toBe("rtbot_ABCDEF");
  });
});
