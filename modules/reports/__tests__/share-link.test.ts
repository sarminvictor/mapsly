/**
 * Unit tests for the share-link helpers (F.8).
 *
 * Per `.claude/rules/testing.md` we cover the invariants that determine
 * whether a recipient sees the briefing OR a graceful expired/not-found:
 *
 *   - `generatePublicShareId` returns 32 lowercase hex chars (no
 *     hyphens, no uppercase) so the URL is short + filename-safe.
 *   - `isValidPublicShareId` rejects anything that isn't 32 hex chars.
 *     This is the gate that protects `getShareableReport` from doing
 *     a DB lookup on attacker-supplied garbage.
 *   - `formatRemainingLabel` is human-friendly and never negative.
 *   - `buildShareUrl` trims trailing slashes deterministically.
 *
 * We deliberately do NOT integration-test `getOrCreateShareLink` or
 * `getShareableReport` here — those hit Prisma, which would pull the
 * Neon driver into the test bundle. The DB side is covered by the
 * preview deploy's smoke check.
 */

import { describe, expect, test } from "vitest";

import {
  DEFAULT_SHARE_TTL_DAYS,
  buildShareUrl,
  formatRemainingLabel,
  generatePublicShareId,
  isValidPublicShareId,
} from "../share-link";

/* --------------------------------------------------- id generator */

describe("generatePublicShareId", () => {
  test("returns 32 lowercase hex chars", () => {
    const id = generatePublicShareId();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
  });

  test("produces distinct ids on consecutive calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generatePublicShareId());
    expect(ids.size).toBe(100);
  });

  test("ids are stable in length (URL/filename safe)", () => {
    for (let i = 0; i < 10; i++) {
      expect(generatePublicShareId()).toHaveLength(32);
    }
  });
});

/* --------------------------------------------------- id validator */

describe("isValidPublicShareId", () => {
  test("accepts 32 lowercase hex chars", () => {
    expect(isValidPublicShareId("a".repeat(32))).toBe(true);
    expect(isValidPublicShareId("0123456789abcdef0123456789abcdef")).toBe(true);
    // a freshly generated id
    expect(isValidPublicShareId(generatePublicShareId())).toBe(true);
  });

  test("rejects wrong length", () => {
    expect(isValidPublicShareId("a".repeat(31))).toBe(false);
    expect(isValidPublicShareId("a".repeat(33))).toBe(false);
    expect(isValidPublicShareId("")).toBe(false);
  });

  test("rejects uppercase", () => {
    expect(isValidPublicShareId("A".repeat(32))).toBe(false);
  });

  test("rejects non-hex characters", () => {
    expect(isValidPublicShareId("g".repeat(32))).toBe(false);
    expect(isValidPublicShareId("z0123456789abcdef0123456789abcde")).toBe(
      false,
    );
    // hyphenated UUID style — we strip hyphens before storing, so
    // a hyphenated form should NOT be considered valid for a lookup.
    expect(isValidPublicShareId("12345678-1234-1234-1234-1234567890ab")).toBe(
      false,
    );
  });

  test("rejects non-string types", () => {
    expect(isValidPublicShareId(null)).toBe(false);
    expect(isValidPublicShareId(undefined)).toBe(false);
    expect(isValidPublicShareId(42)).toBe(false);
    expect(isValidPublicShareId({})).toBe(false);
    expect(isValidPublicShareId([])).toBe(false);
  });
});

/* --------------------------------------------------- remaining label */

describe("formatRemainingLabel", () => {
  const now = new Date("2026-05-21T12:00:00Z");

  test("days remaining (plural)", () => {
    const expiresAt = new Date("2026-06-20T12:00:00Z"); // +30d
    expect(formatRemainingLabel({ now, expiresAt })).toBe("30 days remaining");
  });

  test("single day (no plural)", () => {
    const expiresAt = new Date("2026-05-22T12:00:00Z"); // +24h
    expect(formatRemainingLabel({ now, expiresAt })).toBe("1 day remaining");
  });

  test("hours when less than a day", () => {
    const expiresAt = new Date("2026-05-21T20:00:00Z"); // +8h
    expect(formatRemainingLabel({ now, expiresAt })).toBe("8 hours remaining");
  });

  test("single hour (no plural)", () => {
    const expiresAt = new Date("2026-05-21T13:00:00Z"); // +1h
    expect(formatRemainingLabel({ now, expiresAt })).toBe("1 hour remaining");
  });

  test("minutes when less than an hour", () => {
    const expiresAt = new Date("2026-05-21T12:15:00Z"); // +15m
    expect(formatRemainingLabel({ now, expiresAt })).toBe(
      "15 minutes remaining",
    );
  });

  test("single minute (no plural)", () => {
    const expiresAt = new Date("2026-05-21T12:01:00Z"); // +1m
    expect(formatRemainingLabel({ now, expiresAt })).toBe("1 minute remaining");
  });

  test("returns 'Expired' when expiresAt has passed", () => {
    const expiresAt = new Date("2026-05-21T11:59:00Z"); // -1m
    expect(formatRemainingLabel({ now, expiresAt })).toBe("Expired");
  });

  test("returns 'Expired' at exact equality (no off-by-one)", () => {
    const expiresAt = new Date("2026-05-21T12:00:00Z"); // == now
    expect(formatRemainingLabel({ now, expiresAt })).toBe("Expired");
  });
});

/* --------------------------------------------------- url builder */

describe("buildShareUrl", () => {
  test("composes origin + /share/:id", () => {
    expect(
      buildShareUrl({
        origin: "https://mapsly.ai",
        publicShareId: "abc123",
      }),
    ).toBe("https://mapsly.ai/share/abc123");
  });

  test("strips trailing slashes from the origin", () => {
    expect(
      buildShareUrl({
        origin: "https://mapsly.ai///",
        publicShareId: "abc123",
      }),
    ).toBe("https://mapsly.ai/share/abc123");
  });

  test("works with localhost preview", () => {
    expect(
      buildShareUrl({
        origin: "http://localhost:3000",
        publicShareId: "abc123",
      }),
    ).toBe("http://localhost:3000/share/abc123");
  });
});

/* --------------------------------------------------- constants */

describe("DEFAULT_SHARE_TTL_DAYS", () => {
  test("matches the PLAN.md spec (30 days)", () => {
    expect(DEFAULT_SHARE_TTL_DAYS).toBe(30);
  });
});
