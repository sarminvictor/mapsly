/**
 * Scoring v2 · pillar engine tests
 *
 * Invariant coverage (not snapshot churn). The pillar engine is pure, so these
 * lock the math + the two properties that make the redesign honest:
 *   - market-relativity: the SAME business scores differently in different cells
 *   - the Advertising no-penalty floor
 */

import { describe, expect, test } from "vitest";
import {
  computeAdvertisingPillar,
  computePillars,
  computeProfilePillar,
  computeReputationPillar,
  msiPercentile,
  PILLAR_SCORE_MAX,
  PILLAR_WEIGHTS,
  percentileRank,
} from "../pillars";
import { PILLARS } from "../pillar-types";
import type {
  Breakpoints,
  CellReference,
  PillarSignals,
} from "../pillar-types";

/** Build a full PillarSignals (all null) with overrides. */
function sig(overrides: Partial<PillarSignals> = {}): PillarSignals {
  return {
    rating: null,
    reviewCount: null,
    velocityLast30d: null,
    replyRate: null,
    localPackRank: null,
    organicRankBest: null,
    shareOfVoice: null,
    keywordsRanked: null,
    hasPhone: null,
    hasWebsite: null,
    hasHours: null,
    isClaimed: null,
    photoCount: null,
    categoryCount: null,
    lighthousePerformance: null,
    lighthouseSeo: null,
    lcpSeconds: null,
    hasSchema: null,
    hasBookingCta: null,
    hasPhoneAboveFold: null,
    napConsistent: null,
    hasActiveAds: null,
    metaAdCount: null,
    estMonthlyAdSpend: null,
    brandHijack: null,
    ...overrides,
  };
}

const bp = (
  p10: number,
  p25: number,
  p50: number,
  p75: number,
  p90: number,
): Breakpoints => ({ p10, p25, p50, p75, p90 });

function cell(overrides: Partial<CellReference> = {}): CellReference {
  return {
    sampleSize: 40,
    confidence: "high",
    adPrevalence: null,
    ...overrides,
  };
}

describe("PILLAR_WEIGHTS", () => {
  test("sum to exactly 1.0", () => {
    const total = PILLARS.reduce((acc, p) => acc + PILLAR_WEIGHTS[p], 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("percentileRank", () => {
  const d = bp(10, 25, 50, 80, 120);
  test("at the median → ~0.50", () => {
    expect(percentileRank(50, d)).toBeCloseTo(0.5, 5);
  });
  test("at p90 → caps at 0.95 (never overconfident 1.0)", () => {
    expect(percentileRank(120, d)).toBe(0.95);
    expect(percentileRank(99999, d)).toBe(0.95);
  });
  test("below p10 scales toward 0", () => {
    expect(percentileRank(0, d)).toBeLessThanOrEqual(0.05);
  });
});

describe("computePillars · safety invariants", () => {
  test("all-null signals + null cell → every pillar + master finite in [0,10]", () => {
    const r = computePillars(sig(), null);
    for (const p of PILLARS) {
      expect(Number.isFinite(r[p])).toBe(true);
      expect(r[p]).toBeGreaterThanOrEqual(0);
      expect(r[p]).toBeLessThanOrEqual(PILLAR_SCORE_MAX);
    }
    expect(r.master).toBeGreaterThanOrEqual(0);
    expect(r.master).toBeLessThanOrEqual(PILLAR_SCORE_MAX);
    expect(r.adsApplicable).toBe(false);
  });

  test("NaN / Infinity inputs do not corrupt the score", () => {
    const r = computePillars(
      sig({
        rating: Number.NaN,
        reviewCount: Number.POSITIVE_INFINITY,
        photoCount: -5,
      }),
      null,
    );
    expect(Number.isFinite(r.master)).toBe(true);
    expect(r.master).toBeLessThanOrEqual(PILLAR_SCORE_MAX);
  });

  test("breakdown contributions sum to master", () => {
    const r = computePillars(
      sig({
        rating: 4.6,
        reviewCount: 220,
        replyRate: 0.9,
        hasPhone: true,
        photoCount: 30,
        hasActiveAds: true,
        metaAdCount: 4,
      }),
      cell({ adPrevalence: 0.4 }),
    );
    const summed = r.breakdown.reduce((acc, d2) => acc + d2.contribution, 0);
    expect(summed).toBeCloseTo(r.master, 6);
  });

  test("a strong all-round business beats a broken one", () => {
    const strong = computePillars(
      sig({
        rating: 4.8,
        reviewCount: 400,
        velocityLast30d: 14,
        replyRate: 1,
        localPackRank: 1,
        organicRankBest: 2,
        shareOfVoice: 70,
        hasPhone: true,
        hasWebsite: true,
        hasHours: true,
        isClaimed: true,
        photoCount: 60,
        categoryCount: 3,
        lighthousePerformance: 95,
        lighthouseSeo: 98,
        hasSchema: true,
        hasBookingCta: true,
        hasPhoneAboveFold: true,
        napConsistent: true,
        hasActiveAds: true,
        metaAdCount: 6,
        estMonthlyAdSpend: 3000,
      }),
      null,
    );
    const broken = computePillars(sig({ rating: 2.5 }), null);
    expect(strong.master).toBeGreaterThan(7.5);
    expect(broken.master).toBeLessThan(strong.master);
  });
});

describe("market-relativity · the core mechanic", () => {
  test("the SAME reviews score higher in a weaker cell than a stronger one", () => {
    const business = sig({ rating: 4.5, reviewCount: 200, replyRate: 0.8 });
    const weakCell = cell({ reviewCount: bp(10, 25, 50, 80, 120) });
    const strongCell = cell({ reviewCount: bp(200, 350, 500, 700, 1000) });

    const repWeak = computeReputationPillar(business, weakCell);
    const repStrong = computeReputationPillar(business, strongCell);

    expect(repWeak).toBeGreaterThan(repStrong);
  });

  test("photos are graded vs the cell, not a fixed bar", () => {
    const business = sig({ photoCount: 20 });
    const lowPhotoCell = cell({ photoCount: bp(2, 4, 8, 12, 18) });
    const highPhotoCell = cell({ photoCount: bp(20, 35, 50, 70, 90) });
    expect(computeProfilePillar(business, lowPhotoCell)).toBeGreaterThan(
      computeProfilePillar(business, highPhotoCell),
    );
  });
});

describe("Advertising pillar · the no-penalty floor", () => {
  test("non-advertiser is NOT penalized in a low-ad cell, but IS in a high-ad cell", () => {
    const nonAdvertiser = sig({ hasActiveAds: false });
    const lowAdCell = cell({ adPrevalence: 0.05 });
    const highAdCell = cell({ adPrevalence: 0.8 });

    const low = computeAdvertisingPillar(nonAdvertiser, lowAdCell);
    const high = computeAdvertisingPillar(nonAdvertiser, highAdCell);

    expect(low.score).toBeGreaterThan(high.score);
    expect(low.score).toBeGreaterThanOrEqual(8); // few rivals advertise → fine
    expect(high.score).toBeLessThan(6); // many rivals advertise → real gap
    expect(low.applicable).toBe(false);
  });

  test("unknown market (no cell) is neutral, not max", () => {
    const r = computeAdvertisingPillar(sig({ hasActiveAds: false }), null);
    expect(r.score).toBeGreaterThan(4);
    expect(r.score).toBeLessThan(8);
  });

  test("brand-hijack drops the pillar vs being protected", () => {
    const base = sig({ hasActiveAds: true, metaAdCount: 4 });
    const protectedScore = computeAdvertisingPillar(base, null).score;
    const hijackedScore = computeAdvertisingPillar(
      { ...base, brandHijack: true },
      null,
    ).score;
    expect(hijackedScore).toBeLessThan(protectedScore);
  });
});

describe("msiPercentile", () => {
  test("rank 1 of N → ~100 (top of the cell)", () => {
    expect(msiPercentile(1, 38)).toBe(100);
  });
  test("last rank → ~0", () => {
    expect(msiPercentile(38, 38)).toBe(0);
  });
  test("middle rank → ~50", () => {
    expect(msiPercentile(20, 39)).toBe(50);
  });
  test("a cell of one is its own leader", () => {
    expect(msiPercentile(1, 1)).toBe(100);
  });
});
