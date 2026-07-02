// WP7-2 · opt-out HMAC token round-trip + domain separation.

import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { makeOptOutToken, verifyOptOutToken } from "../token";

describe("opt-out token", () => {
  const OLD = process.env.AUTH_SECRET;
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-abcdefghijklmnopqrstuvwxyz012345";
  });
  afterEach(() => {
    process.env.AUTH_SECRET = OLD;
  });

  test("round-trips a valid email (lowercased)", () => {
    const t = makeOptOutToken("Owner@Business.COM");
    expect(verifyOptOutToken(t)).toBe("owner@business.com");
  });

  test("rejects a tampered signature", () => {
    const t = makeOptOutToken("a@b.com");
    const [payload] = t.split(".");
    expect(verifyOptOutToken(`${payload}.deadbeef`)).toBeNull();
  });

  test("rejects garbage / shapeless input", () => {
    expect(verifyOptOutToken("not-a-token")).toBeNull();
    expect(verifyOptOutToken("")).toBeNull();
    expect(verifyOptOutToken(".")).toBeNull();
  });

  test("a cold /u-style bare-email token does not verify as opt-out", () => {
    // Simulate the cold /u payload shape: base64url(email) with no "optout:"
    // prefix. Even signed with the SAME secret it must fail the prefix check.
    const bare = Buffer.from("a@b.com").toString("base64url");
    // Sign it the way the token module signs (same alg/secret) so the ONLY
    // thing that rejects it is the domain-separation prefix.
    const sig = createHmac("sha256", process.env.AUTH_SECRET as string)
      .update(bare)
      .digest("base64url");
    expect(verifyOptOutToken(`${bare}.${sig}`)).toBeNull();
  });
});
