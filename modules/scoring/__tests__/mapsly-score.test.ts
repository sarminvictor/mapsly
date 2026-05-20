/**
 * Mapsly Score · invariant tests
 *
 * Per `.claude/rules/testing.md` §"Signal scoring", scoring formulas need
 * 100% formula coverage — wrong score = wrong UX everywhere, and the score
 * is the headline number on both portals. Inputs cover the algebraic
 * boundaries (zero, one, weights-isolated) plus defensive paths (NaN,
 * Infinity, negative, above-1).
 */

import { describe, expect, test } from "vitest";
import {
  computeMapslyScore,
  computeMapslyScoreBreakdown,
  computeMapslyScoreFromSnapshot,
  MAPSLY_SCORE_MAX,
  MAPSLY_SCORE_MIN,
  MAPSLY_SCORE_WEIGHTS,
} from "../mapsly-score";
import {
  clamp01,
  deriveBrandPresenceScore,
  deriveCommunicationScore,
  derivePricingTransparencyScore,
  deriveProfileCompletenessScore,
  deriveReputationScore,
  deriveTrustScore,
  REPLY_LATENCY_BAD_HOURS,
  REPLY_LATENCY_PERFECT_HOURS,
  REVIEW_COUNT_SATURATION,
  TRUST_AGE_SATURATION,
  VELOCITY_SATURATION,
} from "../sub-scores";
import { MAPSLY_SCORE_DIMENSIONS, type MapslyScoreSubScores } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ZERO_SUBS: MapslyScoreSubScores = {
  reputation: 0,
  communication: 0,
  profileCompleteness: 0,
  trust: 0,
  pricingTransparency: 0,
  brandPresence: 0,
};

const ONE_SUBS: MapslyScoreSubScores = {
  reputation: 1,
  communication: 1,
  profileCompleteness: 1,
  trust: 1,
  pricingTransparency: 1,
  brandPresence: 1,
};

function onlyDim(
  dim: keyof MapslyScoreSubScores,
  value = 1,
): MapslyScoreSubScores {
  return { ...ZERO_SUBS, [dim]: value };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension vocabulary
// ─────────────────────────────────────────────────────────────────────────────

describe("MAPSLY_SCORE_DIMENSIONS", () => {
  test("exposes exactly the 6 BusinessSnapshot dimensions", () => {
    expect(MAPSLY_SCORE_DIMENSIONS).toEqual([
      "reputation",
      "communication",
      "profileCompleteness",
      "trust",
      "pricingTransparency",
      "brandPresence",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weight invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("MAPSLY_SCORE_WEIGHTS", () => {
  test("sums to exactly 1.0", () => {
    const total = MAPSLY_SCORE_DIMENSIONS.reduce(
      (acc, dim) => acc + MAPSLY_SCORE_WEIGHTS[dim],
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  test("reputation has the largest weight", () => {
    const sorted = [...MAPSLY_SCORE_DIMENSIONS].sort(
      (a, b) => MAPSLY_SCORE_WEIGHTS[b] - MAPSLY_SCORE_WEIGHTS[a],
    );
    expect(sorted[0]).toBe("reputation");
  });

  test("pricing transparency has the smallest weight", () => {
    const sorted = [...MAPSLY_SCORE_DIMENSIONS].sort(
      (a, b) => MAPSLY_SCORE_WEIGHTS[a] - MAPSLY_SCORE_WEIGHTS[b],
    );
    expect(sorted[0]).toBe("pricingTransparency");
  });

  test("every weight is in (0, 1)", () => {
    for (const dim of MAPSLY_SCORE_DIMENSIONS) {
      expect(MAPSLY_SCORE_WEIGHTS[dim]).toBeGreaterThan(0);
      expect(MAPSLY_SCORE_WEIGHTS[dim]).toBeLessThan(1);
    }
  });

  test("is frozen — accidental runtime mutation is rejected", () => {
    expect(Object.isFrozen(MAPSLY_SCORE_WEIGHTS)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Composite — algebraic invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMapslyScore", () => {
  test("returns 0 for all-zero sub-scores", () => {
    expect(computeMapslyScore(ZERO_SUBS)).toBe(0);
  });

  test("returns 10 for all-one sub-scores", () => {
    expect(computeMapslyScore(ONE_SUBS)).toBeCloseTo(10, 10);
  });

  test("each dimension contributes weight × 10 when isolated at 1", () => {
    for (const dim of MAPSLY_SCORE_DIMENSIONS) {
      const score = computeMapslyScore(onlyDim(dim, 1));
      expect(score).toBeCloseTo(MAPSLY_SCORE_WEIGHTS[dim] * 10, 10);
    }
  });

  test("each dimension contributes (weight × subScore × 10) when isolated", () => {
    for (const dim of MAPSLY_SCORE_DIMENSIONS) {
      const score = computeMapslyScore(onlyDim(dim, 0.5));
      expect(score).toBeCloseTo(MAPSLY_SCORE_WEIGHTS[dim] * 0.5 * 10, 10);
    }
  });

  test("reputation alone at 1.0 contributes exactly 2.5", () => {
    expect(computeMapslyScore(onlyDim("reputation", 1))).toBeCloseTo(2.5, 10);
  });

  test("brand presence alone at 1.0 contributes exactly 2.0", () => {
    expect(computeMapslyScore(onlyDim("brandPresence", 1))).toBeCloseTo(2, 10);
  });

  test("pricing transparency alone at 1.0 contributes exactly 1.0", () => {
    expect(computeMapslyScore(onlyDim("pricingTransparency", 1))).toBeCloseTo(
      1,
      10,
    );
  });

  // ── Defensive paths ───────────────────────────────────────────────────────
  test("sub-scores above 1 are clamped, not extrapolated", () => {
    const score = computeMapslyScore({
      ...ZERO_SUBS,
      reputation: 5, // way above 1
    });
    // Should equal reputation alone at 1 → 2.5
    expect(score).toBeCloseTo(2.5, 10);
  });

  test("negative sub-scores are clamped to 0, not extrapolated", () => {
    const score = computeMapslyScore({
      ...ONE_SUBS,
      reputation: -10,
    });
    // Loses the reputation share (2.5), should be 10 - 2.5 = 7.5
    expect(score).toBeCloseTo(7.5, 10);
  });

  test("NaN sub-scores collapse to 0", () => {
    const score = computeMapslyScore({
      ...ONE_SUBS,
      reputation: Number.NaN,
    });
    expect(score).toBeCloseTo(7.5, 10);
  });

  test("Infinity sub-scores collapse to 0", () => {
    const score = computeMapslyScore({
      ...ONE_SUBS,
      reputation: Number.POSITIVE_INFINITY,
    });
    expect(score).toBeCloseTo(7.5, 10);
  });

  test("score is always in [MIN, MAX] for any algebraically-possible input", () => {
    // Cartesian sample: every dimension at 0 / 0.5 / 1 / -5 / 5 / NaN
    const samples = [0, 0.5, 1, -5, 5, Number.NaN];
    for (const a of samples) {
      for (const b of samples) {
        for (const c of samples) {
          const score = computeMapslyScore({
            reputation: a,
            communication: b,
            profileCompleteness: c,
            trust: a,
            pricingTransparency: b,
            brandPresence: c,
          });
          expect(score).toBeGreaterThanOrEqual(MAPSLY_SCORE_MIN);
          expect(score).toBeLessThanOrEqual(MAPSLY_SCORE_MAX);
        }
      }
    }
  });

  test("is referentially transparent — same input → same output", () => {
    const subs: MapslyScoreSubScores = {
      reputation: 0.83,
      communication: 0.42,
      profileCompleteness: 0.91,
      trust: 0.7,
      pricingTransparency: 0.33,
      brandPresence: 0.55,
    };
    expect(computeMapslyScore(subs)).toBe(computeMapslyScore(subs));
  });

  // ── Golden values ─────────────────────────────────────────────────────────
  test("perfect business returns exactly 10", () => {
    expect(computeMapslyScore(ONE_SUBS)).toMatchInlineSnapshot(`10`);
  });

  test("brand-new business (typical scores) returns mid-low", () => {
    // Hypothetical brand-new spa: no reviews, basic profile, no website yet.
    expect(
      computeMapslyScore({
        reputation: 0.1,
        communication: 0.0,
        profileCompleteness: 0.5,
        trust: 0.4,
        pricingTransparency: 0.0,
        brandPresence: 0.1,
      }),
    ).toMatchInlineSnapshot(`1.7999999999999998`);
  });

  test("typical healthy SMB (Maria's spa) returns mid-high", () => {
    // 4.4★ rating with 120 reviews; replies sometimes; complete profile.
    expect(
      computeMapslyScore({
        reputation: 0.78,
        communication: 0.4,
        profileCompleteness: 0.85,
        trust: 0.8,
        pricingTransparency: 0.5,
        brandPresence: 0.6,
      }),
    ).toMatchInlineSnapshot(`6.725`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Breakdown variant
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMapslyScoreBreakdown", () => {
  test("dimensions sum to the same total as computeMapslyScore", () => {
    const subs: MapslyScoreSubScores = {
      reputation: 0.6,
      communication: 0.8,
      profileCompleteness: 0.5,
      trust: 0.9,
      pricingTransparency: 0.4,
      brandPresence: 0.7,
    };
    const breakdown = computeMapslyScoreBreakdown(subs);
    const sumOfContributions = breakdown.dimensions.reduce(
      (acc, d) => acc + d.contribution,
      0,
    );
    expect(sumOfContributions).toBeCloseTo(breakdown.total, 10);
    expect(breakdown.total).toBeCloseTo(computeMapslyScore(subs), 10);
  });

  test("dimensions array preserves MAPSLY_SCORE_DIMENSIONS order", () => {
    const breakdown = computeMapslyScoreBreakdown(ONE_SUBS);
    expect(breakdown.dimensions.map((d) => d.dimension)).toEqual([
      ...MAPSLY_SCORE_DIMENSIONS,
    ]);
  });

  test("each dimension reports its weight from MAPSLY_SCORE_WEIGHTS", () => {
    const breakdown = computeMapslyScoreBreakdown(ZERO_SUBS);
    for (const dim of breakdown.dimensions) {
      expect(dim.weight).toBe(MAPSLY_SCORE_WEIGHTS[dim.dimension]);
    }
  });

  test("sub-scores above 1 are clamped in the breakdown too", () => {
    const breakdown = computeMapslyScoreBreakdown({
      ...ZERO_SUBS,
      reputation: 99,
    });
    const rep = breakdown.dimensions.find((d) => d.dimension === "reputation");
    expect(rep?.subScore).toBe(1);
    expect(rep?.contribution).toBeCloseTo(2.5, 10);
  });

  test("dimensions array is frozen (callers cannot mutate)", () => {
    const breakdown = computeMapslyScoreBreakdown(ONE_SUBS);
    expect(Object.isFrozen(breakdown.dimensions)).toBe(true);
    expect(Object.isFrozen(breakdown.dimensions[0])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot-row convenience
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMapslyScoreFromSnapshot", () => {
  test("matches scalar fn for fully-populated snapshot", () => {
    expect(
      computeMapslyScoreFromSnapshot({
        reputationScore: 0.8,
        communicationScore: 0.5,
        profileCompletenessScore: 0.9,
        trustScore: 0.7,
        pricingTransparencyScore: 0.4,
        brandPresenceScore: 0.6,
      }),
    ).toBeCloseTo(
      computeMapslyScore({
        reputation: 0.8,
        communication: 0.5,
        profileCompleteness: 0.9,
        trust: 0.7,
        pricingTransparency: 0.4,
        brandPresence: 0.6,
      }),
      10,
    );
  });

  test("null dimensions are treated as 0 (conservative)", () => {
    const score = computeMapslyScoreFromSnapshot({
      reputationScore: 1,
      communicationScore: null,
      profileCompletenessScore: null,
      trustScore: null,
      pricingTransparencyScore: null,
      brandPresenceScore: null,
    });
    expect(score).toBeCloseTo(MAPSLY_SCORE_WEIGHTS.reputation * 10, 10);
  });

  test("all-null snapshot returns 0", () => {
    expect(
      computeMapslyScoreFromSnapshot({
        reputationScore: null,
        communicationScore: null,
        profileCompletenessScore: null,
        trustScore: null,
        pricingTransparencyScore: null,
        brandPresenceScore: null,
      }),
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sub-score derivations
// ─────────────────────────────────────────────────────────────────────────────

describe("clamp01", () => {
  test.each([
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [-1, 0],
    [-0.0001, 0],
    [1.0001, 1],
    [99, 1],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])("clamp01(%p) === %p", (input, expected) => {
    expect(clamp01(input)).toBe(expected);
  });
});

describe("deriveReputationScore", () => {
  test("zero everywhere → 0", () => {
    expect(
      deriveReputationScore({
        rating: 0,
        reviewCount: 0,
        velocityLast30d: 0,
      }),
    ).toBe(0);
  });

  test("5★ + saturated reviews + saturated velocity → 1", () => {
    expect(
      deriveReputationScore({
        rating: 5,
        reviewCount: REVIEW_COUNT_SATURATION,
        velocityLast30d: VELOCITY_SATURATION,
      }),
    ).toBeCloseTo(1, 10);
  });

  test("review count above saturation is clipped to 1.0 component", () => {
    const at = deriveReputationScore({
      rating: 5,
      reviewCount: REVIEW_COUNT_SATURATION,
      velocityLast30d: VELOCITY_SATURATION,
    });
    const far = deriveReputationScore({
      rating: 5,
      reviewCount: REVIEW_COUNT_SATURATION * 100,
      velocityLast30d: VELOCITY_SATURATION,
    });
    expect(far).toBeCloseTo(at, 10);
  });

  test("rating dominates — 5★ with no reviews still scores well", () => {
    const score = deriveReputationScore({
      rating: 5,
      reviewCount: 0,
      velocityLast30d: 0,
    });
    // rating contributes 60% of the dimension, fully when 5.0
    expect(score).toBeCloseTo(0.6, 10);
  });

  test("null inputs collapse to 0", () => {
    expect(
      deriveReputationScore({
        rating: null,
        reviewCount: null,
        velocityLast30d: null,
      }),
    ).toBe(0);
  });

  test("negative rating clamps to 0 contribution", () => {
    expect(
      deriveReputationScore({
        rating: -5,
        reviewCount: REVIEW_COUNT_SATURATION,
        velocityLast30d: VELOCITY_SATURATION,
      }),
    ).toBeCloseTo(0.25 + 0.15, 10); // count + velocity only
  });
});

describe("deriveCommunicationScore", () => {
  test("zero reply rate + null latency → 0", () => {
    expect(
      deriveCommunicationScore({
        replyRate: 0,
        avgReplyLatencyHours: null,
      }),
    ).toBe(0);
  });

  test("100% reply rate + perfect latency → 1", () => {
    expect(
      deriveCommunicationScore({
        replyRate: 1,
        avgReplyLatencyHours: REPLY_LATENCY_PERFECT_HOURS,
      }),
    ).toBeCloseTo(1, 10);
  });

  test("100% reply rate + bad latency → 0.7", () => {
    expect(
      deriveCommunicationScore({
        replyRate: 1,
        avgReplyLatencyHours: REPLY_LATENCY_BAD_HOURS,
      }),
    ).toBeCloseTo(0.7, 10);
  });

  test("100% reply rate + null latency → 0.7 (latency component 0)", () => {
    expect(
      deriveCommunicationScore({
        replyRate: 1,
        avgReplyLatencyHours: null,
      }),
    ).toBeCloseTo(0.7, 10);
  });

  test("latency below perfect threshold caps at 1.0 contribution", () => {
    const at = deriveCommunicationScore({
      replyRate: 1,
      avgReplyLatencyHours: REPLY_LATENCY_PERFECT_HOURS,
    });
    const better = deriveCommunicationScore({
      replyRate: 1,
      avgReplyLatencyHours: 1,
    });
    expect(better).toBeCloseTo(at, 10);
  });

  test("reply rate above 1 is clamped", () => {
    expect(
      deriveCommunicationScore({
        replyRate: 99,
        avgReplyLatencyHours: REPLY_LATENCY_PERFECT_HOURS,
      }),
    ).toBeCloseTo(1, 10);
  });

  test("monotonic in reply latency on the linear band", () => {
    const sample = (h: number) =>
      deriveCommunicationScore({ replyRate: 0, avgReplyLatencyHours: h });
    expect(sample(24)).toBeGreaterThan(sample(48));
    expect(sample(48)).toBeGreaterThan(sample(96));
    expect(sample(96)).toBeGreaterThan(sample(REPLY_LATENCY_BAD_HOURS));
  });
});

describe("deriveProfileCompletenessScore", () => {
  test("all flags true + saturated photos → 1", () => {
    expect(
      deriveProfileCompletenessScore({
        hasPhone: true,
        hasWebsite: true,
        hasHours: true,
        photosCount: 100,
        hasCategory: true,
        hasQandA: true,
      }),
    ).toBeCloseTo(1, 10);
  });

  test("all false / null → 0", () => {
    expect(
      deriveProfileCompletenessScore({
        hasPhone: null,
        hasWebsite: null,
        hasHours: null,
        photosCount: null,
        hasCategory: null,
        hasQandA: null,
      }),
    ).toBe(0);
  });

  test("photos alone never reach 1 (5 flag share missing)", () => {
    const score = deriveProfileCompletenessScore({
      hasPhone: false,
      hasWebsite: false,
      hasHours: false,
      photosCount: 100,
      hasCategory: false,
      hasQandA: false,
    });
    expect(score).toBeCloseTo(1 / 6, 10);
  });

  test("five-of-five flags + zero photos returns 5/6", () => {
    expect(
      deriveProfileCompletenessScore({
        hasPhone: true,
        hasWebsite: true,
        hasHours: true,
        photosCount: 0,
        hasCategory: true,
        hasQandA: true,
      }),
    ).toBeCloseTo(5 / 6, 10);
  });
});

describe("deriveTrustScore", () => {
  test("all signals positive + max age → 1", () => {
    expect(
      deriveTrustScore({
        verified: true,
        claimed: true,
        businessAgeYears: TRUST_AGE_SATURATION,
        hasProfilePhoto: true,
        hasRecentReply: true,
      }),
    ).toBeCloseTo(1, 10);
  });

  test("all null / false → 0", () => {
    expect(
      deriveTrustScore({
        verified: null,
        claimed: null,
        businessAgeYears: null,
        hasProfilePhoto: null,
        hasRecentReply: null,
      }),
    ).toBe(0);
  });

  test("age past saturation does not over-credit", () => {
    const at = deriveTrustScore({
      verified: true,
      claimed: true,
      businessAgeYears: TRUST_AGE_SATURATION,
      hasProfilePhoto: true,
      hasRecentReply: true,
    });
    const far = deriveTrustScore({
      verified: true,
      claimed: true,
      businessAgeYears: 99,
      hasProfilePhoto: true,
      hasRecentReply: true,
    });
    expect(far).toBeCloseTo(at, 10);
  });
});

describe("derivePricingTransparencyScore", () => {
  test("all three flags true → 1", () => {
    expect(
      derivePricingTransparencyScore({
        hasPricingPage: true,
        hasServicesList: true,
        hasGbpServices: true,
      }),
    ).toBe(1);
  });

  test("none → 0", () => {
    expect(
      derivePricingTransparencyScore({
        hasPricingPage: null,
        hasServicesList: false,
        hasGbpServices: null,
      }),
    ).toBe(0);
  });

  test("one of three → 1/3", () => {
    expect(
      derivePricingTransparencyScore({
        hasPricingPage: true,
        hasServicesList: false,
        hasGbpServices: false,
      }),
    ).toBeCloseTo(1 / 3, 10);
  });
});

describe("deriveBrandPresenceScore", () => {
  test("perfect Lighthouse + schema + ads + social → 1", () => {
    expect(
      deriveBrandPresenceScore({
        lighthousePerformance: 100,
        lighthouseSeo: 100,
        hasSchema: true,
        hasActiveAds: true,
        hasSocialLinks: true,
      }),
    ).toBeCloseTo(1, 10);
  });

  test("all null → 0", () => {
    expect(
      deriveBrandPresenceScore({
        lighthousePerformance: null,
        lighthouseSeo: null,
        hasSchema: null,
        hasActiveAds: null,
        hasSocialLinks: null,
      }),
    ).toBe(0);
  });

  test("Lighthouse above 100 is clamped (not extrapolated)", () => {
    const at = deriveBrandPresenceScore({
      lighthousePerformance: 100,
      lighthouseSeo: 100,
      hasSchema: false,
      hasActiveAds: false,
      hasSocialLinks: false,
    });
    const above = deriveBrandPresenceScore({
      lighthousePerformance: 5000,
      lighthouseSeo: 5000,
      hasSchema: false,
      hasActiveAds: false,
      hasSocialLinks: false,
    });
    expect(above).toBeCloseTo(at, 10);
  });
});
