/**
 * Scoring v2 · pillar engine tests
 *
 * Invariant coverage (not snapshot churn). The pillar engine is pure, so these
 * lock the math + the two properties that make the redesign honest:
 *   - market-relativity: the SAME business scores differently in different cells
 *   - the Advertising strict-0 rule (not advertising = 0, excluded from master)
 */

import { describe, expect, test } from "vitest";
import {
  computeAdvertisingPillar,
  computePillars,
  computeProfilePillar,
  computeReputationPillar,
  computeVisibilityPillar,
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
    hasActiveGoogleAds: null,
    hasActiveMetaAds: null,
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
  test("all-null signals → every pillar + master is null (unmeasured)", () => {
    const r = computePillars(sig(), null);
    for (const p of PILLARS) expect(r[p]).toBeNull();
    expect(r.master).toBeNull();
    expect(r.adsApplicable).toBe(false);
  });

  test("a pillar with no inputs is null, not a misleading 0", () => {
    // Reputation + Profile have inputs; Website + Visibility do not.
    const r = computePillars(
      sig({ rating: 4.7, reviewCount: 120, hasPhone: true, photoCount: 20 }),
      null,
    );
    expect(r.reputation).not.toBeNull();
    expect(r.profile).not.toBeNull();
    expect(r.website).toBeNull();
    expect(r.visibility).toBeNull();
    expect(r.master).not.toBeNull(); // re-normalized over measured pillars
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
    expect(r.master).not.toBeNull();
    if (r.master != null) {
      expect(Number.isFinite(r.master)).toBe(true);
      expect(r.master).toBeLessThanOrEqual(PILLAR_SCORE_MAX);
    }
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
    expect(r.master).not.toBeNull();
    if (r.master != null) expect(summed).toBeCloseTo(r.master, 6);
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
    expect(strong.master).not.toBeNull();
    expect(broken.master).not.toBeNull();
    if (strong.master != null && broken.master != null) {
      expect(strong.master).toBeGreaterThan(7.5);
      expect(broken.master).toBeLessThan(strong.master);
    }
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

describe("Advertising pillar · 20% Google + 20% Meta + 60% relative volume", () => {
  test("not advertising on either platform → strict 0 + not applicable", () => {
    const r = computeAdvertisingPillar(
      sig({ hasActiveGoogleAds: false, hasActiveMetaAds: false }),
      cell({ adPrevalence: 0.5 }),
    );
    expect(r.score).toBe(0);
    expect(r.applicable).toBe(false);
  });

  test("no ad data at all → null (unknown), not 0", () => {
    const r = computeAdvertisingPillar(sig(), null); // both platform flags null
    expect(r.score).toBeNull();
    expect(r.applicable).toBe(false);
  });

  test("running on either platform → an applicable score ≥ the 20% floor", () => {
    const r = computeAdvertisingPillar(
      sig({ hasActiveGoogleAds: true, hasActiveMetaAds: false }),
      null,
    );
    expect(r.applicable).toBe(true);
    expect(r.score).not.toBeNull();
    // 20% presence floor → at least 2.0/10 even with zero relative volume.
    if (r.score != null) expect(r.score).toBeGreaterThanOrEqual(2);
  });

  test("both platforms beat one (the +20% presence baseline)", () => {
    const both = computeAdvertisingPillar(
      sig({ hasActiveGoogleAds: true, hasActiveMetaAds: true }),
      null,
    );
    const one = computeAdvertisingPillar(
      sig({ hasActiveGoogleAds: true, hasActiveMetaAds: false }),
      null,
    );
    expect(both.applicable).toBe(true);
    if (both.score != null && one.score != null) {
      expect(both.score).toBeGreaterThan(one.score);
    }
  });

  test("more ad volume climbs the 60% vs a quiet advertiser", () => {
    const loud = computeAdvertisingPillar(
      sig({ hasActiveMetaAds: true, metaAdCount: 8, estMonthlyAdSpend: 3000 }),
      null,
    );
    const quiet = computeAdvertisingPillar(
      sig({ hasActiveMetaAds: true, metaAdCount: 1, estMonthlyAdSpend: 100 }),
      null,
    );
    if (loud.score != null && quiet.score != null) {
      expect(loud.score).toBeGreaterThan(quiet.score);
    }
  });

  test("a non-advertiser's master excludes the ads 0 (not dragged)", () => {
    const r = computePillars(
      sig({
        rating: 4.8,
        reviewCount: 300,
        replyRate: 0.9,
        hasPhone: true,
        hasWebsite: true,
        hasHours: true,
        isClaimed: true,
        photoCount: 30,
        categoryCount: 3,
        hasActiveGoogleAds: false,
        hasActiveMetaAds: false,
      }),
      null,
    );
    expect(r.advertising).toBe(0); // shown as a strict 0
    expect(r.adsApplicable).toBe(false);
    expect(r.master).not.toBeNull();
    // Master = reputation + profile re-normalized (≈8.6); if the ads 0 were
    // counted it'd be ≈6.4. >7.5 proves the 0 is excluded, not dragging it.
    if (r.master != null) expect(r.master).toBeGreaterThan(7.5);
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

describe("computeVisibilityPillar · missing-channel must not crater the score", () => {
  // The visibility-2.5 bug: a business that ranks top-3 ORGANICALLY but has no
  // Maps-pack data scored ~2.4/10 — the old formula put 45% on Maps rank +
  // 30% on Maps-only share-of-voice, both → 0 when Maps data is absent.
  test("organic-only top-3 (no Maps, sov 0) scores well, not ~2.5", () => {
    const v = computeVisibilityPillar(
      sig({ localPackRank: null, organicRankBest: 2, shareOfVoice: 0 }),
      null,
    );
    // Old formula: organic(0.95)*0.25 = ~2.4. New: organic carries the full
    // rank term (Maps excluded, not zeroed) → 0.95*0.70 = ~6.65.
    expect(v).toBeGreaterThan(6);
  });

  test("organic-only with top-3 breadth (sov from either channel) scores high", () => {
    const v = computeVisibilityPillar(
      sig({ localPackRank: null, organicRankBest: 1, shareOfVoice: 60 }),
      null,
    );
    expect(v).toBeGreaterThan(9); // dominant organic presence ≈ market leader
  });

  test("both channels present keeps well-ranked businesses high", () => {
    // localPackRank 1 + organicRankBest 2 + sov 70 scored ~9.87 pre-fix; the
    // best-position rank term must keep well-ranked businesses high.
    const v = computeVisibilityPillar(
      sig({ localPackRank: 1, organicRankBest: 2, shareOfVoice: 70 }),
      null,
    );
    expect(v).toBeGreaterThan(9.5);
  });

  test("present-but-POOR Maps doesn't drag a strong organic position", () => {
    // The case the conservative blend got wrong: a real #30 Maps rank (score 0)
    // alongside a #2 organic rank. Best-of-position scores the #2; the weaker
    // channel never pulls a strong position down.
    const v = computeVisibilityPillar(
      sig({ localPackRank: 30, organicRankBest: 2, shareOfVoice: 0 }),
      null,
    );
    expect(v).toBeGreaterThan(6); // rankToScore(2)=0.95 * 0.70 ≈ 6.65
  });

  test("genuinely absent from search still scores ~0", () => {
    const v = computeVisibilityPillar(
      sig({ localPackRank: null, organicRankBest: null, shareOfVoice: null }),
      null,
    );
    expect(v).toBe(0);
  });

  test("ranked-but-poor (#25) counts as poor, unlike absent", () => {
    // A real but poor Maps rank (score 0 at >20) is included, not excluded —
    // only ABSENT data is dropped. With organic also poor, score stays low.
    const poor = computeVisibilityPillar(
      sig({ localPackRank: 25, organicRankBest: 25, shareOfVoice: 0 }),
      null,
    );
    expect(poor).toBeLessThan(2);
  });
});
