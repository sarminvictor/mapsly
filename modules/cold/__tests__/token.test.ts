import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  makeOpenToken,
  makeUnsubscribeToken,
  openPixelUrlFor,
  verifyOpenToken,
  verifyUnsubscribeToken,
} from "../token";

const SECRET_KEY = "COLD_UNSUBSCRIBE_SECRET";
let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env[SECRET_KEY];
  process.env[SECRET_KEY] = "test-secret-for-token-tests";
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = savedSecret;
});

describe("open-pixel tokens", () => {
  test("round-trips a ColdSend id", () => {
    const token = makeOpenToken("clsend123abc");
    expect(verifyOpenToken(token)).toBe("clsend123abc");
  });

  test("rejects a tampered payload", () => {
    const token = makeOpenToken("clsend123abc");
    const [payload = "", sig = ""] = token.split(".");
    const forged = `${Buffer.from("open:other-send").toString("base64url")}.${sig}`;
    expect(verifyOpenToken(forged)).toBeNull();
    expect(verifyOpenToken(`${payload}.AAAA${sig.slice(4)}`)).toBeNull();
  });

  test("rejects garbage shapes", () => {
    expect(verifyOpenToken("")).toBeNull();
    expect(verifyOpenToken("no-dot-here")).toBeNull();
    expect(verifyOpenToken(".only-sig")).toBeNull();
  });

  test("domain separation: an unsubscribe token never verifies as an open token", () => {
    const unsub = makeUnsubscribeToken("owner@clinic.com");
    expect(verifyUnsubscribeToken(unsub)).toBe("owner@clinic.com");
    expect(verifyOpenToken(unsub)).toBeNull();
  });

  test("domain separation: an open token never verifies as an unsubscribe email", () => {
    const open = makeOpenToken("clsend123abc");
    expect(verifyUnsubscribeToken(open)).toBeNull();
  });

  test("openPixelUrlFor builds an absolute /o URL", () => {
    const url = openPixelUrlFor("clsend123abc");
    expect(url).toMatch(/^https:\/\/.+\/o\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
