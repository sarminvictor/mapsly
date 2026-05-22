/**
 * Unit tests for the PR-Ads-competitor-intel additions to
 * modules/smb-ads/types.ts.
 *
 * Per `.claude/rules/testing.md` we cover the invariants Maria would
 * notice if they flipped:
 *
 *   - `deriveLaneStats` correctly counts distinct competitors, picks
 *     the top 3 by ad count, and resolves status with the exact
 *     priority order documented on `AdLaneStatus`.
 *   - `detectParadoxTier` matches the documented thresholds so the
 *     alert never fires when totals are zero or when coverage is OK.
 *
 * The earlier `groupIntoLanes` tests already cover the keyword
 * bucketing + off-keyword flagging; this file is additive.
 */

import { describe, expect, test } from "vitest";

import { type AdEntry, deriveLaneStats, detectParadoxTier } from "../types";

const ad = (overrides: Partial<AdEntry>): AdEntry => ({
  id: overrides.id ?? "ad-test",
  platform: "META",
  adCreativeBody: "creative",
  landingUrl: null,
  lastSeenAt: new Date("2026-05-21T00:00:00Z"),
  advertiserName: null,
  isOwn: false,
  ...overrides,
});

describe("deriveLaneStats", () => {
  test("empty ads → status 'open' with zero counts", () => {
    const lane = deriveLaneStats("botox", [], ["botox"]);
    expect(lane.ownCount).toBe(0);
    expect(lane.competitorCount).toBe(0);
    expect(lane.topCompetitors).toEqual([]);
    expect(lane.status).toBe("open");
  });

  test("only Maria's ads → status 'present'", () => {
    const lane = deriveLaneStats(
      "botox",
      [ad({ id: "a", isOwn: true }), ad({ id: "b", isOwn: true })],
      ["botox"],
    );
    expect(lane.ownCount).toBe(2);
    expect(lane.competitorCount).toBe(0);
    expect(lane.status).toBe("present");
  });

  test("competitors only, none of Maria → 'you-absent'", () => {
    const lane = deriveLaneStats(
      "botox",
      [
        ad({ id: "a", advertiserName: "Lux Med Spa" }),
        ad({ id: "b", advertiserName: "Sisu" }),
      ],
      ["botox"],
    );
    expect(lane.ownCount).toBe(0);
    expect(lane.competitorCount).toBe(2);
    expect(lane.topCompetitors).toEqual(["Lux Med Spa", "Sisu"]);
    expect(lane.status).toBe("you-absent");
  });

  test("3+ distinct competitors → 'crowded' regardless of own presence", () => {
    const lane = deriveLaneStats(
      "botox",
      [
        ad({ id: "a", advertiserName: "Lux" }),
        ad({ id: "b", advertiserName: "Sisu" }),
        ad({ id: "c", advertiserName: "Bella" }),
        ad({ id: "d", advertiserName: "Aurora" }),
        ad({ id: "z", isOwn: true }),
      ],
      ["botox"],
    );
    expect(lane.competitorCount).toBe(4);
    expect(lane.ownCount).toBe(1);
    expect(lane.status).toBe("crowded");
  });

  test("crowded threshold is distinct competitors, not ad count", () => {
    // Two competitors, 5 ads between them — NOT crowded (2 < 3 distinct).
    const lane = deriveLaneStats(
      "filler",
      [
        ad({ id: "1", advertiserName: "Lux" }),
        ad({ id: "2", advertiserName: "Lux" }),
        ad({ id: "3", advertiserName: "Lux" }),
        ad({ id: "4", advertiserName: "Sisu" }),
        ad({ id: "5", advertiserName: "Sisu" }),
      ],
      ["filler"],
    );
    expect(lane.competitorCount).toBe(2);
    expect(lane.status).toBe("you-absent"); // 2 competitors, no own ads
  });

  test("topCompetitors orders by ad count descending then name", () => {
    const lane = deriveLaneStats(
      "facials",
      [
        ad({ id: "1", advertiserName: "Aurora" }),
        ad({ id: "2", advertiserName: "Bella" }),
        ad({ id: "3", advertiserName: "Bella" }),
        ad({ id: "4", advertiserName: "Bella" }),
        ad({ id: "5", advertiserName: "Sisu" }),
        ad({ id: "6", advertiserName: "Sisu" }),
      ],
      ["facials"],
    );
    expect(lane.topCompetitors).toEqual(["Bella", "Sisu", "Aurora"]);
  });

  test("caps topCompetitors at 3 even with more advertisers", () => {
    const lane = deriveLaneStats(
      "facials",
      [
        ad({ id: "1", advertiserName: "Aurora" }),
        ad({ id: "2", advertiserName: "Bella" }),
        ad({ id: "3", advertiserName: "Carmen" }),
        ad({ id: "4", advertiserName: "Delta" }),
        ad({ id: "5", advertiserName: "Eos" }),
      ],
      ["facials"],
    );
    expect(lane.topCompetitors).toHaveLength(3);
  });

  test("competitor ads with blank advertiserName are skipped", () => {
    const lane = deriveLaneStats(
      "facials",
      [
        ad({ id: "1", advertiserName: "Aurora" }),
        ad({ id: "2", advertiserName: "" }),
        ad({ id: "3", advertiserName: "   " }),
        ad({ id: "4", advertiserName: null }),
      ],
      ["facials"],
    );
    expect(lane.competitorCount).toBe(1);
    expect(lane.topCompetitors).toEqual(["Aurora"]);
  });

  test("isOffKeyword passes through deriveLaneStats", () => {
    const lane = deriveLaneStats(
      "dental cleaning",
      [ad({ id: "1", advertiserName: "Aurora" })],
      ["botox", "filler"],
    );
    expect(lane.isOffKeyword).toBe(true);
  });
});

describe("detectParadoxTier", () => {
  test("returns null when totalActiveAds is 0", () => {
    expect(
      detectParadoxTier({
        totalActiveAds: 0,
        lanesCovered: 0,
        totalLanes: 14,
      }),
    ).toBeNull();
  });

  test("returns null when lanes covered ratio ≥ 50%", () => {
    expect(
      detectParadoxTier({
        totalActiveAds: 10,
        lanesCovered: 7,
        totalLanes: 14,
      }),
    ).toBeNull();
  });

  test("'medium' tier when coverage between 25% and 50% with ads running", () => {
    expect(
      detectParadoxTier({
        totalActiveAds: 4,
        lanesCovered: 4,
        totalLanes: 14,
      }),
    ).toBe("medium");
  });

  test("'high' tier requires ≥ 5 ads AND coverage < 25%", () => {
    expect(
      detectParadoxTier({
        totalActiveAds: 13,
        lanesCovered: 0,
        totalLanes: 14,
      }),
    ).toBe("high");
  });

  test("4 ads with low coverage still 'medium' (not enough ads for 'high')", () => {
    expect(
      detectParadoxTier({
        totalActiveAds: 4,
        lanesCovered: 0,
        totalLanes: 14,
      }),
    ).toBe("medium");
  });

  test("handles totalLanes=0 without NaN", () => {
    // Maria has ads but the market has no observed lanes — surface
    // the high-tier alert (we treat 0 lanes as coverage=0).
    expect(
      detectParadoxTier({
        totalActiveAds: 6,
        lanesCovered: 0,
        totalLanes: 0,
      }),
    ).toBe("high");
  });
});
