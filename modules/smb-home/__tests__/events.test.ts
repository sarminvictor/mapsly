/**
 * Unit tests · SMB overview market-events diff engine.
 *
 * Per `.claude/rules/testing.md` we lock the invariants Maria would notice:
 * which deltas surface an event, the notability thresholds, the started/
 * stopped-ads transitions, the search top-3/top-10 promotions, and that the
 * owner's own moves are weighted to the front.
 */

import { describe, expect, test } from "vitest";

import {
  type BizWeek,
  type SnapshotSignals,
  deriveMarketChanges,
} from "../events";

const WEEK = new Date("2026-06-01T00:00:00Z");

const sig = (o: Partial<SnapshotSignals> = {}): SnapshotSignals => ({
  snapshotDate: WEEK,
  rating: null,
  reviewCount: null,
  photosCount: null,
  hasActiveGoogleAds: null,
  hasActiveMetaAds: null,
  localPackRank: null,
  organicRankBest: null,
  lighthousePerformance: null,
  ...o,
});

const biz = (
  current: SnapshotSignals,
  prior: SnapshotSignals | null,
  extra: Partial<BizWeek> = {},
): BizWeek => ({
  businessId: "b1",
  name: "Acme",
  isOwn: false,
  current,
  prior,
  ...extra,
});

describe("deriveMarketChanges", () => {
  test("no prior week → no events (nothing to diff)", () => {
    expect(deriveMarketChanges([biz(sig({ rating: 4.8 }), null)])).toEqual([]);
  });

  test("rating rising is a good event with the right delta", () => {
    const [e] = deriveMarketChanges([
      biz(sig({ rating: 4.8 }), sig({ rating: 4.5 })),
    ]);
    expect(e?.type).toBe("rating");
    expect(e?.tone).toBe("good");
    expect(e?.delta).toBe("+0.3");
    expect(e?.body).toMatch(/rose to 4\.8/);
  });

  test("rating slipping is a bad event", () => {
    const [e] = deriveMarketChanges([
      biz(sig({ rating: 4.6 }), sig({ rating: 4.8 })),
    ]);
    expect(e?.tone).toBe("bad");
    expect(e?.delta).toBe("-0.2");
  });

  test("rating moves below the 0.1 threshold are ignored", () => {
    expect(
      deriveMarketChanges([biz(sig({ rating: 4.84 }), sig({ rating: 4.8 }))]),
    ).toEqual([]);
  });

  test("reviews surface at +3, not at +2", () => {
    expect(
      deriveMarketChanges([
        biz(sig({ reviewCount: 12 }), sig({ reviewCount: 9 })),
      ])[0]?.type,
    ).toBe("reviews");
    expect(
      deriveMarketChanges([
        biz(sig({ reviewCount: 11 }), sig({ reviewCount: 9 })),
      ]),
    ).toEqual([]);
  });

  test("starting Google ads emits an ads event tagged Google", () => {
    const [e] = deriveMarketChanges([
      biz(
        sig({ hasActiveGoogleAds: true }),
        sig({ hasActiveGoogleAds: false }),
      ),
    ]);
    expect(e?.type).toBe("ads");
    expect(e?.delta).toBe("Google");
    expect(e?.body).toMatch(/started running Google ads/);
  });

  test("stopping Meta ads emits an ads event tagged Meta", () => {
    const [e] = deriveMarketChanges([
      biz(sig({ hasActiveMetaAds: false }), sig({ hasActiveMetaAds: true })),
    ]);
    expect(e?.delta).toBe("Meta");
    expect(e?.body).toMatch(/stopped running Facebook & Instagram ads/);
  });

  test("breaking into the top 3 of local search is a good event", () => {
    const [e] = deriveMarketChanges([
      biz(sig({ localPackRank: 2 }), sig({ localPackRank: 6 })),
    ]);
    expect(e?.type).toBe("search");
    expect(e?.delta).toBe("▲ top 3");
  });

  test("climbing into the top 10 (not top 3) reports top 10", () => {
    const [e] = deriveMarketChanges([
      biz(sig({ organicRankBest: 8 }), sig({ organicRankBest: 14 })),
    ]);
    expect(e?.body).toMatch(/top 10/);
  });

  test("a ≥10-point website speed jump surfaces; an 8-point move does not", () => {
    expect(
      deriveMarketChanges([
        biz(
          sig({ lighthousePerformance: 82 }),
          sig({ lighthousePerformance: 70 }),
        ),
      ])[0]?.type,
    ).toBe("website");
    expect(
      deriveMarketChanges([
        biz(
          sig({ lighthousePerformance: 78 }),
          sig({ lighthousePerformance: 70 }),
        ),
      ]),
    ).toEqual([]);
  });

  test("the owner's own move is weighted to the front of the feed", () => {
    const competitor = biz(sig({ rating: 5.0 }), sig({ rating: 4.0 }), {
      businessId: "c",
      name: "Rival",
    }); // big rating weight
    const owner = biz(sig({ reviewCount: 12 }), sig({ reviewCount: 9 }), {
      businessId: "me",
      name: "You",
      isOwn: true,
    }); // small weight, but boosted
    const events = deriveMarketChanges([competitor, owner]);
    expect(events[0]?.isOwn).toBe(true);
  });
});
