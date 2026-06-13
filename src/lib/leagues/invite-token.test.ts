import { describe, expect, it } from "vitest";

import {
  generateInviteToken,
  hashInviteToken,
  inviteTokenPrefix,
} from "./invite-token";

describe("generateInviteToken", () => {
  it("produces an rtlnk_-scheme token with a 64-hex SHA-256 hash", async () => {
    const { token, hash, prefix } = await generateInviteToken();
    expect(token.startsWith("rtlnk_")).toBe(true);
    expect(token.length).toBeGreaterThan("rtlnk_".length + 30);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.startsWith(prefix)).toBe(true);
  });

  it("returns a hash consistent with hashInviteToken(token)", async () => {
    const { token, hash } = await generateInviteToken();
    expect(await hashInviteToken(token)).toBe(hash);
  });

  it("does not leak the raw secret in the stored prefix", async () => {
    const { token, prefix } = await generateInviteToken();
    expect(prefix.length).toBeLessThan(token.length);
    expect(token.startsWith(prefix)).toBe(true);
  });

  it("generates unique tokens and hashes across many calls", async () => {
    const tokens = new Set<string>();
    const hashes = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const generated = await generateInviteToken();
      tokens.add(generated.token);
      hashes.add(generated.hash);
    }
    expect(tokens.size).toBe(200);
    expect(hashes.size).toBe(200);
  });
});

describe("hashInviteToken", () => {
  it("is stable for equal input", async () => {
    expect(await hashInviteToken("rtlnk_example")).toBe(
      await hashInviteToken("rtlnk_example"),
    );
  });

  it("differs for different input", async () => {
    expect(await hashInviteToken("rtlnk_a")).not.toBe(
      await hashInviteToken("rtlnk_b"),
    );
  });
});

describe("inviteTokenPrefix", () => {
  it("returns the scheme plus the first six body characters", () => {
    expect(inviteTokenPrefix("rtlnk_ABCDEFGHIJ")).toBe("rtlnk_ABCDEF");
  });
});
