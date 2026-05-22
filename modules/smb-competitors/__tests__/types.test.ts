/**
 * Unit tests for the SMB competitors pure helpers.
 * Per `.claude/rules/testing.md` we cover invariants Maria would
 * feel: head-to-head direction math + threat priority + voice promise.
 */

import { describe, expect, test } from "vitest";

import {
  EMPTY_SMB_COMPETITORS,
  MAX_THREATS,
  type CompetitorRow,
  deriveHeadToHead,
  deriveThreats,
} from "../types";

const row = (overrides: Partial<CompetitorRow>): CompetitorRow => ({
  id: overrides.id ?? "r1",
  name: overrides.name ?? "Test Spa",
  isOwn: overrides.isOwn ?? false,
  rating: 4.4,
  reviewCount: 200,
  mapslyScore: 6.0,
  velocityLast30d: 5,
  replyRate: 0.5,
  profileCompletenessScore: 0.7,
  photosCount: 30,
  isSameBuilding: false,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  ...overrides,
});

describe("EMPTY_SMB_COMPETITORS", () => {
  test("includes new headToHead / leaderName / threats fields", () => {
    expect(EMPTY_SMB_COMPETITORS.headToHead).toEqual([]);
    expect(EMPTY_SMB_COMPETITORS.leaderName).toBeNull();
    expect(EMPTY_SMB_COMPETITORS.threats).toEqual([]);
  });
});

describe("deriveHeadToHead", () => {
  test("returns 7 dimensions in stable order", () => {
    const out = deriveHeadToHead(
      row({ id: "me", isOwn: true }),
      row({ id: "rival", name: "Lux" }),
    );
    expect(out.map((d) => d.key)).toEqual([
      "mapsly_score",
      "rating",
      "reviews",
      "reply_rate",
      "velocity",
      "photos",
      "profile",
    ]);
  });

  test("returns [] when either side is missing", () => {
    expect(deriveHeadToHead(null, row({}))).toEqual([]);
    expect(deriveHeadToHead(row({}), null)).toEqual([]);
  });

  test("direction = +1 when Maria is ahead", () => {
    const out = deriveHeadToHead(
      row({ id: "me", isOwn: true, mapslyScore: 7 }),
      row({ id: "rival", mapslyScore: 5 }),
    );
    expect(out[0]?.direction).toBe(1);
    expect(out[0]?.ownShare).toBeGreaterThan(0.5);
  });

  test("direction = -1 when Maria is behind", () => {
    const out = deriveHeadToHead(
      row({ id: "me", isOwn: true, mapslyScore: 4 }),
      row({ id: "rival", mapslyScore: 8 }),
    );
    expect(out[0]?.direction).toBe(-1);
    expect(out[0]?.ownShare).toBeLessThan(0.5);
  });

  test("null values render as em dash without crashing", () => {
    const out = deriveHeadToHead(
      row({ id: "me", isOwn: true, replyRate: null }),
      row({ id: "rival", replyRate: null }),
    );
    const replyRow = out.find((d) => d.key === "reply_rate");
    expect(replyRow?.ownValue).toBe("—");
    expect(replyRow?.leaderValue).toBe("—");
  });
});

describe("deriveThreats", () => {
  test("returns [] when own is missing", () => {
    expect(deriveThreats({ own: null, competitors: [] })).toEqual([]);
  });

  test("surfaces same-building competitors as 'high' tier first", () => {
    const own = row({ id: "me", isOwn: true });
    const competitors = [
      row({ id: "rival1", name: "Lux", isSameBuilding: true }),
      row({ id: "rival2", name: "Sisu", isSameBuilding: false }),
    ];
    const threats = deriveThreats({ own, competitors });
    expect(threats[0]?.tier).toBe("high");
    expect(threats[0]?.body).toMatch(/Lux/);
    expect(threats[0]?.body).toMatch(/your building/);
  });

  test("flags leader pulling ahead when score gap ≥ 1.5", () => {
    const own = row({ id: "me", isOwn: true, mapslyScore: 5 });
    const competitors = [row({ id: "leader", name: "Lux", mapslyScore: 8 })];
    const threats = deriveThreats({ own, competitors });
    expect(threats.find((t) => t.body.includes("pulling ahead"))).toBeDefined();
  });

  test("does NOT flag leader when gap < 1.5", () => {
    const own = row({ id: "me", isOwn: true, mapslyScore: 6 });
    const competitors = [row({ id: "leader", name: "Lux", mapslyScore: 7 })];
    const threats = deriveThreats({ own, competitors });
    expect(
      threats.find((t) => t.body.includes("pulling ahead")),
    ).toBeUndefined();
  });

  test("flags newcomers (created < 90 days ago)", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const recent = new Date("2026-05-15T00:00:00Z"); // 17 days
    const old = new Date("2025-01-01T00:00:00Z"); // > 90 days
    const own = row({ id: "me", isOwn: true });
    const threats = deriveThreats({
      own,
      now,
      competitors: [
        row({ id: "new", name: "Aurora", createdAt: recent }),
        row({ id: "old", name: "Bella", createdAt: old }),
      ],
    });
    const newcomerThreat = threats.find((t) => t.tier === "rising");
    expect(newcomerThreat?.body).toMatch(/Aurora/);
  });

  test("caps at MAX_THREATS rows", () => {
    const own = row({ id: "me", isOwn: true, mapslyScore: 4 });
    const now = new Date("2026-06-01T00:00:00Z");
    const recent = new Date("2026-05-15T00:00:00Z");
    const threats = deriveThreats({
      own,
      now,
      competitors: [
        row({ id: "sb1", name: "A", isSameBuilding: true }),
        row({ id: "sb2", name: "B", isSameBuilding: true }),
        row({ id: "lead", name: "C", mapslyScore: 9 }),
        row({ id: "new1", name: "D", createdAt: recent }),
        row({ id: "vel", name: "E", velocityLast30d: 50 }),
      ],
    });
    expect(threats.length).toBeLessThanOrEqual(MAX_THREATS);
  });

  test("body copy stays Maria voice — no banned jargon", () => {
    const own = row({ id: "me", isOwn: true, mapslyScore: 4 });
    const threats = deriveThreats({
      own,
      competitors: [
        row({ id: "sb", name: "Lux", isSameBuilding: true }),
        row({ id: "lead", name: "Sisu", mapslyScore: 9 }),
      ],
    });
    const haystack = threats.map((t) => `${t.body} ${t.meta ?? ""}`).join(" ");
    expect(haystack).not.toMatch(
      /\b(LCP|INP|CLS|CTR|MSI|3-pack|local 3-pack|schema|NAP|GBP|organic rank)\b/i,
    );
  });
});
