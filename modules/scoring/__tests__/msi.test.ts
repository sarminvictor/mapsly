/**
 * MSI · invariant tests
 *
 * Per `.claude/rules/testing.md` "Signal scoring", MSI is a scoring
 * formula and needs 100% formula coverage. The whole point of MSI is
 * stable ranking — bugs here corrupt every metro leaderboard in the
 * product. Tests cover:
 *   - Algebraic boundaries (empty, single, two-business tie).
 *   - Ordering invariants (desc by score, ASC by id on tie).
 *   - Determinism (rerun yields identical ranks).
 *   - Defensive inputs (null / NaN / Infinity / negative).
 *   - Cross-metro partitioning (rankByMsiInMetros).
 */

import { describe, expect, test } from "vitest";

import { MAPSLY_SCORE_MAX } from "../mapsly-score";
import {
  adVisibilityBonus,
  computeMsiScore,
  MSI_AD_BONUS,
  MSI_SCORE_MAX,
  MSI_VOLUME_BONUS,
  MSI_VOLUME_SATURATION,
  rankByMsiInMetro,
  rankByMsiInMetros,
  reviewVolumeBonus,
  type MsiInput,
} from "../msi";

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

/** Build a complete MsiInput in one call, defaults are "neutral". */
function input(
  id: string,
  partial: Partial<Omit<MsiInput, "businessId">> = {},
): MsiInput {
  const defaults: Omit<MsiInput, "businessId"> = {
    mapslyScore: 5,
    reviewCount: 0,
    hasActiveAds: false,
  };
  // Spread `partial` AFTER defaults so explicit `null` overrides.
  return { businessId: id, ...defaults, ...partial };
}

// ---------------------------------------------------------------------------
// reviewVolumeBonus
// ---------------------------------------------------------------------------

describe("reviewVolumeBonus", () => {
  test("zero reviews -> zero bonus", () => {
    expect(reviewVolumeBonus(0)).toBe(0);
  });

  test("null -> zero bonus", () => {
    expect(reviewVolumeBonus(null)).toBe(0);
  });

  test("negative -> zero bonus (defensive)", () => {
    expect(reviewVolumeBonus(-10)).toBe(0);
  });

  test("NaN -> zero bonus (defensive)", () => {
    expect(reviewVolumeBonus(Number.NaN)).toBe(0);
  });

  test("Infinity -> zero bonus (defensive)", () => {
    expect(reviewVolumeBonus(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test("monotonic in [1, SATURATION]", () => {
    let prev = reviewVolumeBonus(1);
    for (const rc of [10, 50, 100, 250, 499]) {
      const next = reviewVolumeBonus(rc);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  test("saturates at MSI_VOLUME_BONUS", () => {
    // At the saturation point, bonus equals MSI_VOLUME_BONUS exactly
    // (log1p(SAT) / log1p(SAT) = 1).
    expect(reviewVolumeBonus(MSI_VOLUME_SATURATION)).toBeCloseTo(
      MSI_VOLUME_BONUS,
      10,
    );
  });

  test("clamped above saturation", () => {
    expect(reviewVolumeBonus(MSI_VOLUME_SATURATION * 10)).toBe(
      MSI_VOLUME_BONUS,
    );
    expect(reviewVolumeBonus(MSI_VOLUME_SATURATION * 1000)).toBe(
      MSI_VOLUME_BONUS,
    );
  });

  test("first reviews matter more (log-shape)", () => {
    // Delta from 0->10 reviews must be greater than 490->500.
    const earlyDelta = reviewVolumeBonus(10) - reviewVolumeBonus(0);
    const lateDelta =
      reviewVolumeBonus(MSI_VOLUME_SATURATION) - reviewVolumeBonus(490);
    expect(earlyDelta).toBeGreaterThan(lateDelta);
  });
});

// ---------------------------------------------------------------------------
// adVisibilityBonus
// ---------------------------------------------------------------------------

describe("adVisibilityBonus", () => {
  test("true -> MSI_AD_BONUS", () => {
    expect(adVisibilityBonus(true)).toBe(MSI_AD_BONUS);
  });

  test("false -> 0", () => {
    expect(adVisibilityBonus(false)).toBe(0);
  });

  test("null -> 0", () => {
    expect(adVisibilityBonus(null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeMsiScore
// ---------------------------------------------------------------------------

describe("computeMsiScore", () => {
  test("neutral inputs -> mapslyScore", () => {
    expect(
      computeMsiScore(
        input("b1", { mapslyScore: 5, reviewCount: 0, hasActiveAds: false }),
      ),
    ).toBe(5);
  });

  test("null mapslyScore -> 0 base", () => {
    expect(
      computeMsiScore(
        input("b1", { mapslyScore: null, reviewCount: 0, hasActiveAds: false }),
      ),
    ).toBe(0);
  });

  test("NaN mapslyScore -> 0 base (defensive)", () => {
    expect(
      computeMsiScore(
        input("b1", {
          mapslyScore: Number.NaN,
          reviewCount: 0,
          hasActiveAds: false,
        }),
      ),
    ).toBe(0);
  });

  test("Infinity mapslyScore -> 0 base (defensive)", () => {
    expect(
      computeMsiScore(
        input("b1", {
          mapslyScore: Number.POSITIVE_INFINITY,
          reviewCount: 0,
          hasActiveAds: false,
        }),
      ),
    ).toBe(0);
  });

  test("negative mapslyScore -> 0 base", () => {
    expect(
      computeMsiScore(
        input("b1", { mapslyScore: -1, reviewCount: 0, hasActiveAds: false }),
      ),
    ).toBe(0);
  });

  test("above-max mapslyScore -> clamped to MAPSLY_SCORE_MAX before bonuses", () => {
    const score = computeMsiScore(
      input("b1", { mapslyScore: 999, reviewCount: 0, hasActiveAds: false }),
    );
    expect(score).toBe(MAPSLY_SCORE_MAX);
  });

  test("perfect inputs -> MSI_SCORE_MAX", () => {
    const score = computeMsiScore(
      input("b1", {
        mapslyScore: MAPSLY_SCORE_MAX,
        reviewCount: MSI_VOLUME_SATURATION * 10,
        hasActiveAds: true,
      }),
    );
    expect(score).toBeCloseTo(MSI_SCORE_MAX, 9);
  });

  test("bonuses additive on top of base", () => {
    const base = 7;
    const score = computeMsiScore(
      input("b1", {
        mapslyScore: base,
        reviewCount: MSI_VOLUME_SATURATION,
        hasActiveAds: true,
      }),
    );
    expect(score).toBeCloseTo(base + MSI_VOLUME_BONUS + MSI_AD_BONUS, 9);
  });

  test("never produces NaN even with all-NaN inputs", () => {
    const score = computeMsiScore({
      businessId: "b1",
      mapslyScore: Number.NaN,
      reviewCount: Number.NaN,
      hasActiveAds: null,
    });
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rankByMsiInMetro
// ---------------------------------------------------------------------------

describe("rankByMsiInMetro", () => {
  test("empty input -> empty Map", () => {
    const result = rankByMsiInMetro([]);
    expect(result.size).toBe(0);
  });

  test("single business -> rank 1 of 1", () => {
    const result = rankByMsiInMetro([input("solo", { mapslyScore: 7 })]);
    expect(result.size).toBe(1);
    const solo = result.get("solo");
    expect(solo).toBeDefined();
    expect(solo!.msiRank).toBe(1);
    expect(solo!.msiTotal).toBe(1);
    expect(solo!.msiScore).toBe(7);
  });

  test("ranks DESC by msiScore", () => {
    const businesses = [
      input("low", { mapslyScore: 3 }),
      input("hi", { mapslyScore: 9 }),
      input("mid", { mapslyScore: 6 }),
    ];
    const result = rankByMsiInMetro(businesses);
    expect(result.get("hi")!.msiRank).toBe(1);
    expect(result.get("mid")!.msiRank).toBe(2);
    expect(result.get("low")!.msiRank).toBe(3);
  });

  test("msiTotal identical across every result", () => {
    const businesses = [
      input("a", { mapslyScore: 7 }),
      input("b", { mapslyScore: 5 }),
      input("c", { mapslyScore: 3 }),
      input("d", { mapslyScore: 1 }),
    ];
    const result = rankByMsiInMetro(businesses);
    for (const v of result.values()) {
      expect(v.msiTotal).toBe(4);
    }
  });

  test("ties broken by businessId ASC", () => {
    const businesses = [
      input("zzz", { mapslyScore: 5 }),
      input("aaa", { mapslyScore: 5 }),
      input("mmm", { mapslyScore: 5 }),
    ];
    const result = rankByMsiInMetro(businesses);
    expect(result.get("aaa")!.msiRank).toBe(1);
    expect(result.get("mmm")!.msiRank).toBe(2);
    expect(result.get("zzz")!.msiRank).toBe(3);
  });

  test("review volume tiebreaks within same mapslyScore (different msiScore)", () => {
    // Same mapslyScore but different review counts -> different msiScore.
    const businesses = [
      input("small", { mapslyScore: 7, reviewCount: 5 }),
      input("big", { mapslyScore: 7, reviewCount: 400 }),
    ];
    const result = rankByMsiInMetro(businesses);
    expect(result.get("big")!.msiRank).toBe(1);
    expect(result.get("small")!.msiRank).toBe(2);
  });

  test("ads tiebreaks within same mapslyScore + reviewCount", () => {
    const businesses = [
      input("noads", { mapslyScore: 7, reviewCount: 50, hasActiveAds: false }),
      input("ads", { mapslyScore: 7, reviewCount: 50, hasActiveAds: true }),
    ];
    const result = rankByMsiInMetro(businesses);
    expect(result.get("ads")!.msiRank).toBe(1);
    expect(result.get("noads")!.msiRank).toBe(2);
  });

  test("volume bonus must NOT flip clearly different tiers", () => {
    // The whole point of small bonus magnitudes: a 7.0 with 1000 reviews
    // should NEVER outrank an 8.0 with 50 reviews. This is the invariant
    // that keeps the headline Mapsly Score meaningful.
    const businesses = [
      input("eight_few", { mapslyScore: 8, reviewCount: 50 }),
      input("seven_many", { mapslyScore: 7, reviewCount: 1000 }),
    ];
    const result = rankByMsiInMetro(businesses);
    expect(result.get("eight_few")!.msiRank).toBe(1);
    expect(result.get("seven_many")!.msiRank).toBe(2);
  });

  test("ranks are deterministic across reruns", () => {
    const businesses = [
      input("a", { mapslyScore: 5 }),
      input("b", { mapslyScore: 5 }),
      input("c", { mapslyScore: 5 }),
    ];
    const run1 = rankByMsiInMetro(businesses);
    const run2 = rankByMsiInMetro(businesses);
    for (const id of ["a", "b", "c"]) {
      expect(run1.get(id)!.msiRank).toBe(run2.get(id)!.msiRank);
    }
  });

  test("every business in input appears once in output", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const businesses = ids.map((id, i) => input(id, { mapslyScore: i }));
    const result = rankByMsiInMetro(businesses);
    expect(result.size).toBe(ids.length);
    for (const id of ids) {
      expect(result.has(id)).toBe(true);
    }
  });

  test("ranks cover 1..n contiguously", () => {
    const businesses = Array.from({ length: 10 }, (_, i) =>
      input(`b${i}`, { mapslyScore: Math.random() * 10 }),
    );
    const result = rankByMsiInMetro(businesses);
    const ranks = Array.from(result.values())
      .map((r) => r.msiRank)
      .sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("defensive inputs do not produce NaN msiScore in results", () => {
    const businesses: MsiInput[] = [
      {
        businessId: "corrupt",
        mapslyScore: Number.NaN,
        reviewCount: Number.NaN,
        hasActiveAds: null,
      },
      input("ok", { mapslyScore: 5, reviewCount: 100, hasActiveAds: true }),
    ];
    const result = rankByMsiInMetro(businesses);
    expect(Number.isFinite(result.get("corrupt")!.msiScore)).toBe(true);
    expect(result.get("ok")!.msiRank).toBe(1);
    expect(result.get("corrupt")!.msiRank).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// rankByMsiInMetros (multi-metro partitioning)
// ---------------------------------------------------------------------------

describe("rankByMsiInMetros", () => {
  test("partitions by metro key independently", () => {
    type WithMetro = MsiInput & { metro: string };
    const businesses: WithMetro[] = [
      { ...input("miami_a", { mapslyScore: 8 }), metro: "miami" },
      { ...input("miami_b", { mapslyScore: 6 }), metro: "miami" },
      { ...input("nyc_a", { mapslyScore: 4 }), metro: "nyc" },
      { ...input("nyc_b", { mapslyScore: 9 }), metro: "nyc" },
    ];
    const result = rankByMsiInMetros(businesses, (b) => b.metro);

    expect(result.get("miami_a")!.msiRank).toBe(1);
    expect(result.get("miami_a")!.msiTotal).toBe(2);
    expect(result.get("miami_b")!.msiRank).toBe(2);
    expect(result.get("miami_b")!.msiTotal).toBe(2);

    expect(result.get("nyc_b")!.msiRank).toBe(1);
    expect(result.get("nyc_b")!.msiTotal).toBe(2);
    expect(result.get("nyc_a")!.msiRank).toBe(2);
    expect(result.get("nyc_a")!.msiTotal).toBe(2);
  });

  test("null metro key bucketed as __unknown__ (not dropped)", () => {
    type WithMetro = MsiInput & { metro: string | null };
    const businesses: WithMetro[] = [
      { ...input("known", { mapslyScore: 7 }), metro: "miami" },
      { ...input("nomet", { mapslyScore: 5 }), metro: null },
    ];
    const result = rankByMsiInMetros(businesses, (b) => b.metro);
    expect(result.size).toBe(2);
    // Known metro is alone in its bucket -> rank 1 of 1.
    expect(result.get("known")!.msiRank).toBe(1);
    expect(result.get("known")!.msiTotal).toBe(1);
    // Unknown metro is also alone in its synthetic bucket -> rank 1 of 1.
    expect(result.get("nomet")!.msiRank).toBe(1);
    expect(result.get("nomet")!.msiTotal).toBe(1);
  });

  test("empty input -> empty Map", () => {
    const result = rankByMsiInMetros([], () => "anything");
    expect(result.size).toBe(0);
  });

  test("every business appears exactly once", () => {
    type WithMetro = MsiInput & { metro: string };
    const businesses: WithMetro[] = Array.from({ length: 15 }, (_, i) => ({
      ...input(`b${i}`, { mapslyScore: i % 10 }),
      metro: `metro_${i % 3}`,
    }));
    const result = rankByMsiInMetros(businesses, (b) => b.metro);
    expect(result.size).toBe(15);
    for (let i = 0; i < 15; i++) {
      expect(result.has(`b${i}`)).toBe(true);
    }
  });
});
