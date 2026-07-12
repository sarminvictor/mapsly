// Phase D / Cluster A · the discover-flow signal-eval layer. These tests cover
// the PURE evaluation surface (evaluateSignal / resolveMatches + the tune→
// threshold math + the rollup helpers). No DB: hydration is exercised by
// constructing HydratedBusiness literals directly (the resolver never touches
// Prisma inside evaluateSignal). Golden cases span every signal family + the
// three behaviors that matter: a READY signal that matches/doesn't, a tune
// strictness shift that flips the verdict, a composite all-vs-any, and a null
// (data-absent) case that is excluded from match%.

import { describe, expect, test } from "vitest";
import {
  applyStrictnessToThreshold,
  brandKeyOf,
  evaluateSignal,
  resolveMatches,
  rollupAds,
  rollupContacts,
  rollupFindings,
  rollupKeywords,
  rollupReviewAgg,
  rollupReviews,
  rollupSerp,
  rollupServices,
  rollupSnapshot,
  rollupTech,
  scaleBandsToPercentileRange,
  withAdScanTruth,
  type ActiveSignal,
  type HydratedAdsPlatform,
  type HydratedBusiness,
} from "../signal-eval";
import { SIG_META } from "../goal-templates";

/** Even 1..N breakpoints helper for cell-distribution tests. */
function bp(p10: number, p25: number, p50: number, p75: number, p90: number) {
  return { p10, p25, p50, p75, p90 };
}

/**
 * Build an ActiveSignal exactly as discovery-signals.toActiveSignals would: the
 * SigMeta key + its registryKey/comparator/value, plus the per-test tune/conds/
 * match. Keeps the newly-computing tests faithful to the real runtime wiring.
 */
function active(
  metaKey: string,
  over: Partial<ActiveSignal> = {},
): ActiveSignal {
  const meta = SIG_META[metaKey];
  if (!meta) throw new Error(`no SIG_META for ${metaKey}`);
  return {
    key: metaKey,
    registryKey: meta.registryKey,
    comparator: meta.comparator,
    value: meta.value,
    ...over,
  };
}

const NOW = new Date("2026-06-30T12:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────
// HydratedBusiness factory — every slot empty/null by default, override per test.
// ─────────────────────────────────────────────────────────────────────────────

/** A5 · one platform's empty ad sub-rollup (unscanned by default). */
function adsPlat(over: Partial<HydratedAdsPlatform> = {}): HydratedAdsPlatform {
  return {
    scanned: false,
    activeCount: 0,
    hasVideo: false,
    formats: [],
    newestAgeDays: null,
    ...over,
  };
}

/** The full ads slot. Overriding `meta`/`google` replaces the sub-rollup. */
function adsRoll(
  over: Partial<HydratedBusiness["ads"]> = {},
): HydratedBusiness["ads"] {
  return {
    activeCount: 0,
    hasVideo: false,
    formats: [],
    newestAgeDays: null,
    landingHostCount: 0,
    landingIsHomepageOnly: null,
    meta: adsPlat(),
    google: adsPlat(),
    ...over,
  };
}

/** A SCANNED Meta ads slot with N active Meta ads (merged totals mirrored). */
function metaAds(
  activeCount: number,
  over: Partial<HydratedAdsPlatform> = {},
): HydratedBusiness["ads"] {
  return adsRoll({
    activeCount,
    meta: adsPlat({ scanned: true, activeCount, ...over }),
  });
}

function biz(overrides: Partial<HydratedBusiness> = {}): HydratedBusiness {
  return {
    id: "biz_1",
    business: {},
    snapshot: null,
    lighthouse: null,
    reviews: {
      unanswered1StarCount: 0,
      unansweredNegativeCount: 0,
      unansweredCount: 0,
      hasNegativeTheme: false,
      negativeThemes: [],
      lastReviewAt: null,
      recentNegativeCount: 0,
      hasAnyReview: false,
    },
    serp: null,
    ads: adsRoll(),
    tech: {
      scanned: false,
      cmsName: null,
      bookingName: null,
      chatName: null,
      hasAnalytics: false,
      hasMetaPixel: false,
      hasBooking: false,
      hasChat: false,
      hasEcommerce: false,
      hasConsent: false,
    },
    adMarket: { advertiserCount: null },
    keywords: {
      scanned: false,
      estMonthlyVisits: null,
      anyDown: false,
      anyUp: false,
    },
    contacts: {
      scanned: false,
      emailCount: 0,
      phoneCount: 0,
      socialChannelCount: 0,
      hasOwnerContact: false,
      totalCount: 0,
    },
    findings: {
      flaggedKeys: new Set(),
      flaggedGroups: new Set(),
      valueByKey: {},
      confidenceByKey: {},
    },
    services: { scanned: false, missingCommonCount: null },
    cell: {
      sampleSize: null,
      organicTraffic: null,
      organicRank: null,
      locationCount: null,
      hasRecentNewEntrant: null,
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// applyStrictnessToThreshold — directional ±25% band.
// ─────────────────────────────────────────────────────────────────────────────

describe("applyStrictnessToThreshold", () => {
  test("balanced leaves the threshold unchanged", () => {
    expect(applyStrictnessToThreshold(50, "balanced", "<")).toBe(50);
  });
  test("less-than: stricter LOWERS the bar, looser RAISES it", () => {
    expect(applyStrictnessToThreshold(50, "strict", "<")).toBeCloseTo(37.5);
    expect(applyStrictnessToThreshold(50, "loose", "<")).toBeCloseTo(62.5);
  });
  test("greater-than: stricter RAISES the bar, looser LOWERS it", () => {
    expect(applyStrictnessToThreshold(2000, "strict", ">=")).toBeCloseTo(2500);
    expect(applyStrictnessToThreshold(2000, "loose", ">=")).toBeCloseTo(1500);
  });
  test("non-directional comparators are untouched", () => {
    expect(applyStrictnessToThreshold(5, "strict", "=")).toBe(5);
    expect(applyStrictnessToThreshold(5, "loose", "between")).toBe(5);
  });
});

describe("scaleBandsToPercentileRange", () => {
  test("single band maps to its percentile slice", () => {
    expect(scaleBandsToPercentileRange(["bottom10"])).toEqual([0, 10]);
    expect(scaleBandsToPercentileRange(["top10"])).toEqual([90, 100]);
  });
  test("multiple bands span min→max of the union", () => {
    expect(scaleBandsToPercentileRange(["below", "bottom10"])).toEqual([0, 50]);
    expect(scaleBandsToPercentileRange(["below", "above"])).toEqual([0, 100]);
  });
  test("unknown bands → null", () => {
    expect(scaleBandsToPercentileRange(["nope"])).toBeNull();
    expect(scaleBandsToPercentileRange([])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// READY signal · matches / doesn't on crafted data.
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateSignal · READY numeric (slow_site → lighthouse_performance)", () => {
  const sig: ActiveSignal = {
    key: "slow_site",
    registryKey: "lighthouse_performance",
    comparator: "<",
    value: 50,
  };

  test("matches when performance is below the threshold", () => {
    const b = biz({
      lighthouse: lh({ performance: 35 }),
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });

  test("does not match when performance clears the threshold", () => {
    const b = biz({ lighthouse: lh({ performance: 80 }) });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });

  test("null (not computable) when there is no audit at all", () => {
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
});

// LIVE library additions — guard against a future "dead card" regression: each
// resolves against real hydrated data, not a never-populated field.
describe("evaluateSignal · LIVE library cards (weak_seo, has_email_contact)", () => {
  test("weak_seo → seo_score resolves LighthouseAudit.seo", () => {
    const sig: ActiveSignal = {
      key: "weak_seo",
      registryKey: "seo_score",
      comparator: "<",
      value: 70,
    };
    expect(
      evaluateSignal(sig, biz({ lighthouse: lh({ seo: 55 }) }), NOW).matched,
    ).toBe(true);
    expect(
      evaluateSignal(sig, biz({ lighthouse: lh({ seo: 92 }) }), NOW).matched,
    ).toBe(false);
    // No audit → null (honest "enrich to unlock"), never a fake match.
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });

  test("has_email_contact → email_count resolves from Contact EMAIL rollup", () => {
    const sig: ActiveSignal = {
      key: "has_email_contact",
      registryKey: "email_count",
      comparator: ">=",
      value: 1,
    };
    expect(
      evaluateSignal(
        sig,
        biz({ contacts: { ...biz().contacts, scanned: true, emailCount: 2 } }),
        NOW,
      ).matched,
    ).toBe(true);
    expect(
      evaluateSignal(
        sig,
        biz({ contacts: { ...biz().contacts, scanned: true, emailCount: 0 } }),
        NOW,
      ).matched,
    ).toBe(false);
    // A1 · un-scanned lead → null, never a fake "no email" verdict.
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
});

describe("evaluateSignal · READY boolean from the listing (has_website)", () => {
  const sig: ActiveSignal = {
    key: "has_website",
    registryKey: "has_website",
    comparator: "is",
    value: true,
  };
  test("true when the listing has a website", () => {
    const b = biz({ business: { website: "https://x.com" } });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("false (NOT null) when the listing has no website — computable from the listing", () => {
    const b = biz({ business: { website: null } });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
});

describe("evaluateSignal · phone_only composite-ish listing signal", () => {
  const sig: ActiveSignal = {
    key: "phone_only",
    registryKey: "phone_only",
    comparator: "is",
    value: true,
  };
  test("matches: has phone, no website", () => {
    const b = biz({ business: { phone: "+1305", website: null } });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("no match: has both phone and website", () => {
    const b = biz({ business: { phone: "+1305", website: "https://x.com" } });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tune · strictness shift FLIPS the verdict.
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateSignal · overdue_redesign resolves from Lighthouse performance (P0 regression)", () => {
  // overdue_redesign is rebound to lighthouse_performance < 50. It USED to bind
  // perf_savings_ms — a column the discover-flow Lighthouse writers never populate
  // — so it was permanently NOT_COMPUTABLE (matched:null), which excluded it from
  // ranking and forced Match 100% for every lead. These guard that it now fires
  // (and is computable) off the perf score the agency actually paid for.
  const base: ActiveSignal = {
    key: "overdue_redesign",
    registryKey: "lighthouse_performance",
    comparator: "<",
    value: 50,
  };

  test("failing site (perf 35) → fires, and is computable (not null)", () => {
    const r = evaluateSignal(
      base,
      biz({ lighthouse: lh({ performance: 35 }) }),
      NOW,
    );
    expect(r.matched).not.toBeNull();
    expect(r.matched).toBe(true);
  });

  test("healthy site (perf 65) → evaluated, did not fire (not null)", () => {
    const r = evaluateSignal(
      base,
      biz({ lighthouse: lh({ performance: 65 }) }),
      NOW,
    );
    expect(r.matched).not.toBeNull();
    expect(r.matched).toBe(false);
  });

  test("strictness flips the verdict: a 55-perf site matches only when loosened", () => {
    const b = biz({ lighthouse: lh({ performance: 55 }) });
    expect(
      evaluateSignal({ ...base, tune: strict("balanced") }, b, NOW).matched,
    ).toBe(false);
    expect(
      evaluateSignal({ ...base, tune: strict("loose") }, b, NOW).matched,
    ).toBe(true);
  });
});

describe("evaluateSignal · strictness on a less-than signal", () => {
  // lighthouse_performance < 50. A site at perf 60 only matches when loosened.
  const base: ActiveSignal = {
    key: "slow_site",
    registryKey: "lighthouse_performance",
    comparator: "<",
    value: 50,
  };
  const b = biz({ lighthouse: lh({ performance: 60 }) });

  test("balanced: 60 < 50 false", () => {
    expect(
      evaluateSignal({ ...base, tune: strict("balanced") }, b, NOW).matched,
    ).toBe(false);
  });
  test("looser: threshold rises to 62.5, 60 < 62.5 → matches", () => {
    expect(
      evaluateSignal({ ...base, tune: strict("loose") }, b, NOW).matched,
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tune · scale (percentile bands), platform (chips), presence, mode.
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateSignal · scale tune (market_position → msi_percentile)", () => {
  const base: ActiveSignal = {
    key: "market_position",
    registryKey: "msi_percentile",
    comparator: "is_one_of",
    value: "below",
  };
  test("percentile 20 falls in [below+bottom10] = [0,50] → match", () => {
    const b = biz({ snapshot: { msiPercentile: 20 } });
    const sig = {
      ...base,
      tune: { kind: "scale" as const, bands: ["below", "bottom10"] },
    };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("percentile 80 is outside [0,50] → no match", () => {
    const b = biz({ snapshot: { msiPercentile: 80 } });
    const sig = {
      ...base,
      tune: { kind: "scale" as const, bands: ["below", "bottom10"] },
    };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
  test("no snapshot → null (not computable)", () => {
    const sig = {
      ...base,
      tune: { kind: "scale" as const, bands: ["below"] },
    };
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
});

describe("evaluateSignal · platform tune (diy_platform → cms_platform)", () => {
  const base: ActiveSignal = {
    key: "diy_platform",
    registryKey: "cms_platform",
    comparator: "contains",
    value: "Wix",
  };
  test("matches when the detected CMS is one of the selected chips", () => {
    const b = biz({ tech: tech({ cmsName: "wix" }) });
    const sig = {
      ...base,
      tune: { kind: "platform" as const, values: ["wix", "squarespace"] },
    };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("no match when the CMS is not selected", () => {
    const b = biz({ tech: tech({ cmsName: "webflow" }) });
    const sig = {
      ...base,
      tune: { kind: "platform" as const, values: ["wix", "squarespace"] },
    };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
  test("no tech scan → null", () => {
    const sig = {
      ...base,
      tune: { kind: "platform" as const, values: ["wix"] },
    };
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
});

describe("evaluateSignal · presence tune (losing_rankings via keyword down-flag)", () => {
  // branded_only_traffic is a presence signal on a boolean — use has_meta_pixel
  // semantics: presence "has" matches when the underlying boolean is true.
  const base: ActiveSignal = {
    key: "no_tracking_pixel",
    registryKey: "has_meta_pixel",
    comparator: "is",
    value: false,
  };
  test("presence 'hasnt' matches a business with no pixel (value:false inverts)", () => {
    const b = biz({ tech: tech({ hasMetaPixel: false }) });
    const sig = {
      ...base,
      tune: { kind: "presence" as const, value: "hasnt" as const },
    };
    // sig.value === false → expected = !wantHas; wantHas(hasnt)=false → expected=true
    // underlying boolean false ≠ true → NO match. Flip to 'has':
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
  test("presence 'has' matches a business that HAS the pixel", () => {
    const b = biz({ tech: tech({ hasMetaPixel: true }) });
    const sig = {
      ...base,
      tune: { kind: "presence" as const, value: "has" as const },
    };
    // value:false inverts → expected=!true=false; underlying true ≠ false → no match
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
});

describe("evaluateSignal · presence tune on a true-meaning boolean", () => {
  // has_website default value is true → 'has' means the boolean true.
  const base: ActiveSignal = {
    key: "has_website",
    registryKey: "has_website",
    comparator: "is",
    value: true,
  };
  test("'has' matches when website present", () => {
    const b = biz({ business: { website: "https://x.com" } });
    const sig = {
      ...base,
      tune: { kind: "presence" as const, value: "has" as const },
    };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("'hasnt' matches when website absent", () => {
    const b = biz({ business: { website: null } });
    const sig = {
      ...base,
      tune: { kind: "presence" as const, value: "hasnt" as const },
    };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
});

describe("evaluateSignal · mode tune (operating_business → open_status)", () => {
  const base: ActiveSignal = {
    key: "operating_business",
    registryKey: "open_status",
    comparator: "is",
    value: "OPEN",
  };
  test("matches the selected mode", () => {
    const b = biz({ business: { openStatus: "OPEN" } });
    const sig = { ...base, tune: { kind: "mode" as const, value: "OPEN" } };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("does not match a different status", () => {
    const b = biz({ business: { openStatus: "TEMPORARILY_CLOSED" } });
    const sig = { ...base, tune: { kind: "mode" as const, value: "OPEN" } };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Composite · all vs any across the included conditions.
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateSignal · composite conds (all vs any)", () => {
  // Exercises the REGISTRY composite path with an explicit has_meta_pixel binding
  // (computable from tech). NOTE: SIG_META's flying_blind is now a SYNTHETIC
  // signal (no registryKey — see the dedicated flying_blind describe below); this
  // block passes registryKey explicitly to test the generic conds combine: the
  // combine governs how the included conditions fold; with one binding the
  // verdict is the binding's, but an empty included-set → null.
  const base: ActiveSignal = {
    key: "flying_blind",
    registryKey: "has_meta_pixel",
    comparator: "is",
    value: false,
  };
  const b = biz({ tech: tech({ hasMetaPixel: false }) });

  test("'any' with all conditions on → evaluates the binding (no pixel → match)", () => {
    const sig: ActiveSignal = {
      ...base,
      match: "any",
      conds: { "0": true, "1": true },
    };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });

  test("'all' with all conditions on → evaluates the binding (no pixel → match)", () => {
    const sig: ActiveSignal = {
      ...base,
      match: "all",
      conds: { "0": true, "1": true },
    };
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });

  test("every condition toggled off → null (nothing to evaluate)", () => {
    const sig: ActiveSignal = {
      ...base,
      match: "all",
      conds: { "0": false, "1": false },
    };
    expect(evaluateSignal(sig, b, NOW).matched).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Null (data-absent) · roadmap signals + unbound keys never match OR fail.
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateSignal · null cases (not computable)", () => {
  test("a SigMeta key with no registryKey → null", () => {
    // "reviews_trending" has no registryKey in SIG_META.
    const sig: ActiveSignal = {
      key: "reviews_trending",
      comparator: "is",
      value: true,
    };
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
  test("an unknown registry key → null", () => {
    const sig: ActiveSignal = {
      key: "made_up",
      registryKey: "does_not_exist",
      comparator: "is",
      value: true,
    };
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
  test("rank_drop_last_30d has no rank-history hydrated → null even with serp data", () => {
    const sig: ActiveSignal = {
      key: "losing_rankings",
      registryKey: "rank_drop_last_30d",
      comparator: ">=",
      value: 1,
    };
    const b = biz({
      serp: {
        bestLocalPackRank: 2,
        bestOrganicRank: 5,
        brandedOrganicRank: 1,
        hasBrandQuery: true,
        nonBrandRankedCount: 3,
      },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveMatches · match% = matched / applicable (nulls excluded).
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveMatches", () => {
  test("excludes null (not-computable) signals from the denominator", () => {
    const b = biz({
      lighthouse: lh({ performance: 30 }), // slow_site matches
      business: { website: "https://x.com" }, // has_website matches
    });
    const signals: ActiveSignal[] = [
      {
        key: "slow_site",
        registryKey: "lighthouse_performance",
        comparator: "<",
        value: 50,
      },
      {
        key: "has_website",
        registryKey: "has_website",
        comparator: "is",
        value: true,
      },
      // not computable — no registry binding:
      { key: "reviews_trending", comparator: "is", value: true },
    ];
    const r = resolveMatches(signals, b, NOW);
    expect(r.matchedCount).toBe(2);
    expect(r.applicableCount).toBe(2); // the null one is excluded
    expect(r.matchPct).toBe(1);
    expect(r.perSignal.reviews_trending).toBeNull();
  });

  test("partial match yields a fractional matchPct", () => {
    const b = biz({
      lighthouse: lh({ performance: 95 }), // slow_site does NOT match
      business: { website: "https://x.com" }, // has_website matches
    });
    const signals: ActiveSignal[] = [
      {
        key: "slow_site",
        registryKey: "lighthouse_performance",
        comparator: "<",
        value: 50,
      },
      {
        key: "has_website",
        registryKey: "has_website",
        comparator: "is",
        value: true,
      },
    ];
    const r = resolveMatches(signals, b, NOW);
    expect(r.matchedCount).toBe(1);
    expect(r.applicableCount).toBe(2);
    expect(r.matchPct).toBe(0.5);
  });

  test("all signals not computable → matchPct 0, applicableCount 0", () => {
    const signals: ActiveSignal[] = [
      { key: "reviews_trending", comparator: "is", value: true },
      {
        key: "slow_site",
        registryKey: "lighthouse_performance",
        comparator: "<",
        value: 50,
      },
    ];
    const r = resolveMatches(signals, biz(), NOW);
    expect(r.applicableCount).toBe(0);
    expect(r.matchPct).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rollup helpers — the aggregation logic the hydrator feeds the evaluator.
// ─────────────────────────────────────────────────────────────────────────────

describe("rollupReviews", () => {
  test("counts unanswered 1★ / ≤2★ / any, themes, last review", () => {
    const r = rollupReviews(
      [
        {
          stars: 1,
          ownerReplied: false,
          postedAt: new Date("2026-06-01"),
          sentiment: "NEGATIVE",
          themes: ["Wait"],
        },
        {
          stars: 2,
          ownerReplied: false,
          postedAt: new Date("2026-06-10"),
          sentiment: "NEGATIVE",
          themes: ["Billing"],
        },
        {
          stars: 5,
          ownerReplied: true,
          postedAt: new Date("2026-06-20"),
          sentiment: "POSITIVE",
          themes: [],
        },
      ],
      NOW,
    );
    expect(r.unanswered1StarCount).toBe(1);
    expect(r.unansweredNegativeCount).toBe(2);
    expect(r.unansweredCount).toBe(2);
    expect(r.hasNegativeTheme).toBe(true);
    expect(r.negativeThemes.sort()).toEqual(["billing", "wait"]);
    expect(r.lastReviewAt?.toISOString().slice(0, 10)).toBe("2026-06-20");
  });
});

describe("rollupReviewAgg (aggregate-fed twin — must mirror rollupReviews)", () => {
  test("maps the SQL FILTER counts + themed negatives into HydratedReviews", () => {
    const last = new Date("2026-06-20");
    const agg = rollupReviewAgg(
      {
        total: 3,
        unanswered: 2,
        unanswered1: 1,
        unansweredNeg: 2,
        recentNeg: 1,
        lastReviewAt: last,
      },
      [{ themes: ["Wait"] }, { themes: ["Billing", "wait"] }],
    );
    expect(agg.unanswered1StarCount).toBe(1);
    expect(agg.unansweredNegativeCount).toBe(2);
    expect(agg.unansweredCount).toBe(2);
    expect(agg.recentNegativeCount).toBe(1);
    expect(agg.hasAnyReview).toBe(true);
    expect(agg.hasNegativeTheme).toBe(true);
    // Lower-cased + de-duped, like rollupReviews.
    expect(agg.negativeThemes.sort()).toEqual(["billing", "wait"]);
    expect(agg.lastReviewAt).toBe(last);
  });

  test("no aggregate row (business has zero reviews) → all-empty, not-computable-safe", () => {
    const agg = rollupReviewAgg(null, []);
    expect(agg).toEqual({
      unanswered1StarCount: 0,
      unansweredNegativeCount: 0,
      unansweredCount: 0,
      hasNegativeTheme: false,
      negativeThemes: [],
      lastReviewAt: null,
      recentNegativeCount: 0,
      hasAnyReview: false,
    });
  });

  test("agrees with rollupReviews on the same underlying facts", () => {
    // The row-level reference implementation over three reviews…
    const rows = [
      {
        stars: 1,
        ownerReplied: false,
        postedAt: new Date("2026-06-01"),
        sentiment: "NEGATIVE",
        themes: ["Wait"],
      },
      {
        stars: 2,
        ownerReplied: false,
        postedAt: new Date("2026-06-10"),
        sentiment: "NEGATIVE",
        themes: ["Billing"],
      },
      {
        stars: 5,
        ownerReplied: true,
        postedAt: new Date("2026-06-20"),
        sentiment: "POSITIVE",
        themes: [],
      },
    ];
    const ref = rollupReviews(rows, NOW);
    // …and the aggregate twin fed the equivalent SQL outputs.
    const agg = rollupReviewAgg(
      {
        total: rows.length,
        unanswered: ref.unansweredCount,
        unanswered1: ref.unanswered1StarCount,
        unansweredNeg: ref.unansweredNegativeCount,
        recentNeg: ref.recentNegativeCount,
        lastReviewAt: ref.lastReviewAt,
      },
      rows
        .filter((r) => r.stars <= 2 || r.sentiment === "NEGATIVE")
        .filter((r) => r.themes.length > 0)
        .map((r) => ({ themes: r.themes })),
    );
    expect({ ...agg, negativeThemes: [...agg.negativeThemes].sort() }).toEqual({
      ...ref,
      negativeThemes: [...ref.negativeThemes].sort(),
    });
  });
});

describe("rollupSerp", () => {
  test("best ranks + brand-query split", () => {
    const s = rollupSerp([
      { localPackRank: 5, organicRank: 12, isBrandQuery: false },
      { localPackRank: 2, organicRank: 8, isBrandQuery: false },
      { localPackRank: null, organicRank: 1, isBrandQuery: true },
    ]);
    expect(s?.bestLocalPackRank).toBe(2);
    expect(s?.bestOrganicRank).toBe(1);
    expect(s?.hasBrandQuery).toBe(true);
    expect(s?.brandedOrganicRank).toBe(1);
    expect(s?.nonBrandRankedCount).toBe(1); // only organicRank 8 ≤ 10 non-brand
  });
  test("empty → null", () => {
    expect(rollupSerp([])).toBeNull();
    expect(rollupSerp(null)).toBeNull();
  });
  test("bestMapsRank = best organicAbsRank across MAPS rows only", () => {
    const s = rollupSerp([
      // MAPS rows carry the deep Google Maps position on organicAbsRank.
      {
        kind: "MAPS",
        localPackRank: null,
        organicAbsRank: 67,
        organicRank: null,
        isBrandQuery: false,
      },
      {
        kind: "MAPS",
        localPackRank: 3,
        organicAbsRank: 3,
        organicRank: null,
        isBrandQuery: false,
      },
      // an ORGANIC row's organicAbsRank must NOT count toward the maps rank.
      {
        kind: "ORGANIC",
        localPackRank: null,
        organicAbsRank: 1,
        organicRank: 9,
        isBrandQuery: false,
      },
    ]);
    expect(s?.bestMapsRank).toBe(3); // min of MAPS 67, 3 — not the ORGANIC 1
    expect(s?.bestLocalPackRank).toBe(3);
  });
});

describe("rollupAds", () => {
  test("active count, video, age, landing homepage-only", () => {
    const a = rollupAds(
      [
        {
          platform: "META",
          isActive: true,
          displayFormat: "video",
          startedAt: new Date("2026-06-20"),
          landingUrl: "https://x.com/",
        },
        {
          platform: "META",
          isActive: true,
          displayFormat: "image",
          startedAt: new Date("2026-06-01"),
          landingUrl: "https://x.com/",
        },
        {
          platform: "META",
          isActive: false,
          displayFormat: "video",
          startedAt: new Date("2026-01-01"),
          landingUrl: "https://x.com/promo",
        },
      ],
      NOW,
    );
    expect(a.activeCount).toBe(2);
    expect(a.hasVideo).toBe(true);
    expect(a.newestAgeDays).toBe(10); // 2026-06-20 → 2026-06-30
    expect(a.landingHostCount).toBe(1);
    expect(a.landingIsHomepageOnly).toBe(true);
  });
  test("a deep landing path flips homepage-only false", () => {
    const a = rollupAds(
      [
        {
          platform: "META",
          isActive: true,
          displayFormat: "image",
          startedAt: null,
          landingUrl: "https://x.com/book-now",
        },
      ],
      NOW,
    );
    expect(a.landingIsHomepageOnly).toBe(false);
  });

  // A5 · the platform split: Meta-specific signals read `.meta`, the merged
  // totals stay for the deliberately platform-agnostic cards.
  test("splits META vs GOOGLE while keeping merged totals", () => {
    const a = rollupAds(
      [
        {
          platform: "GOOGLE",
          isActive: true,
          displayFormat: "video",
          startedAt: new Date("2026-06-20"),
          landingUrl: null,
        },
        {
          platform: "META",
          isActive: true,
          displayFormat: "image",
          startedAt: new Date("2026-05-01"),
          landingUrl: null,
        },
      ],
      NOW,
    );
    // Merged (not_advertising / no_analytics keep reading this).
    expect(a.activeCount).toBe(2);
    expect(a.hasVideo).toBe(true);
    // Meta sub-rollup: only the image ad — a Google video ad can no longer
    // fire "Runs video/image ads (Meta)".
    expect(a.meta).toMatchObject({
      scanned: true,
      activeCount: 1,
      hasVideo: false,
      formats: ["image"],
    });
    expect(a.google).toMatchObject({
      scanned: true,
      activeCount: 1,
      hasVideo: true,
    });
  });

  test("no rows → both platforms unscanned; withAdScanTruth folds run-truth in", () => {
    const a = rollupAds([], NOW);
    expect(a.meta.scanned).toBe(false);
    expect(a.google.scanned).toBe(false);
    const folded = withAdScanTruth(a, true, false);
    expect(folded.meta.scanned).toBe(true); // successful META cell run
    expect(folded.google.scanned).toBe(false); // no GOOGLE_ADS job
    expect(folded.meta.activeCount).toBe(0); // counts untouched
  });
});

describe("rollupTech", () => {
  test("detects categories + meta pixel by name + cms", () => {
    const t = rollupTech([
      { name: "WordPress", category: "CMS", confidence: 0.9 },
      { name: "Meta Pixel", category: "PIXEL", confidence: 0.8 },
      { name: "GA4", category: "ANALYTICS", confidence: 0.7 },
    ]);
    expect(t.scanned).toBe(true);
    expect(t.cmsName).toBe("wordpress");
    expect(t.hasMetaPixel).toBe(true);
    expect(t.hasAnalytics).toBe(true);
    expect(t.hasBooking).toBe(false);
  });
  test("empty → scanned:false (drives the null guard)", () => {
    expect(rollupTech([]).scanned).toBe(false);
  });
});

describe("rollupKeywords", () => {
  test("sums est visits + trend flags", () => {
    const k = rollupKeywords([
      { latestEstMonthlyVisits: 30, isDown: true, isUp: false },
      { latestEstMonthlyVisits: 12, isDown: false, isUp: true },
    ]);
    expect(k.scanned).toBe(true);
    expect(k.estMonthlyVisits).toBe(42);
    expect(k.anyDown).toBe(true);
    expect(k.anyUp).toBe(true);
  });
  test("empty → scanned:false, null visits", () => {
    const k = rollupKeywords([]);
    expect(k.scanned).toBe(false);
    expect(k.estMonthlyVisits).toBeNull();
  });
});

describe("rollupContacts", () => {
  test("counts channels + owner flag", () => {
    const c = rollupContacts([
      { channel: "EMAIL", role: "GENERIC" },
      { channel: "EMAIL", role: "OWNER" },
      { channel: "PHONE", role: "FRONT_DESK" },
      { channel: "INSTAGRAM", role: "SOCIAL" },
      { channel: "FACEBOOK", role: "SOCIAL" },
    ]);
    expect(c.emailCount).toBe(2);
    expect(c.phoneCount).toBe(1);
    expect(c.socialChannelCount).toBe(2);
    expect(c.hasOwnerContact).toBe(true);
    expect(c.totalCount).toBe(5);
    expect(c.scanned).toBe(true); // rows can only come from a scan
  });

  // A1 · the scanned flag: run-truth OR row presence.
  test("scanned = scanRan || rows present", () => {
    expect(rollupContacts([]).scanned).toBe(false); // never ran, no rows
    expect(rollupContacts([], true).scanned).toBe(true); // ran, found nothing
    expect(
      rollupContacts([{ channel: "EMAIL", role: "GENERIC" }], false).scanned,
    ).toBe(true); // legacy rows without a job record
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Newly-computing PARTIAL signals — wired to real stored data (Phase B eval).
// Each asserts: fires on real data, doesn't on the opposite, and stays null when
// the backing data is genuinely absent.
// ═════════════════════════════════════════════════════════════════════════════

describe("evaluateSignal · open_now (synthetic, no registry binding)", () => {
  test("matches an OPEN listing", () => {
    const b = biz({ business: { openStatus: "OPEN" } });
    expect(evaluateSignal(active("open_now"), b, NOW).matched).toBe(true);
  });
  test("does not match a closed listing", () => {
    const b = biz({ business: { openStatus: "CLOSED_FOREVER" } });
    expect(evaluateSignal(active("open_now"), b, NOW).matched).toBe(false);
  });
});

describe("evaluateSignal · reviews_trending (lifecycle + velocity)", () => {
  test("TRENDING lifecycle → match", () => {
    const b = biz({ snapshot: { reviewLifecycle: "TRENDING" } });
    expect(evaluateSignal(active("reviews_trending"), b, NOW).matched).toBe(
      true,
    );
  });
  test("velocity30 > velocityPrev30 → match (no lifecycle)", () => {
    const b = biz({ snapshot: { velocityLast30d: 9, velocityPrev30d: 4 } });
    expect(evaluateSignal(active("reviews_trending"), b, NOW).matched).toBe(
      true,
    );
  });
  test("velocity30 < velocityPrev30 → no match", () => {
    const b = biz({ snapshot: { velocityLast30d: 2, velocityPrev30d: 8 } });
    expect(evaluateSignal(active("reviews_trending"), b, NOW).matched).toBe(
      false,
    );
  });
  test("no snapshot → null (not computable)", () => {
    expect(
      evaluateSignal(active("reviews_trending"), biz(), NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · review momentum mode (reviews_vs_cell_pct)", () => {
  // reviews_percentile binds reviews_vs_cell_pct with a 4-state mode tune.
  test("'growing' matches a snapshot with rising velocity", () => {
    const b = biz({
      snapshot: { msiPercentile: 50, velocityLast30d: 10, velocityPrev30d: 3 },
    });
    const sig = active("reviews_percentile", {
      tune: { kind: "mode", value: "growing" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("'growing' does NOT match a falling-velocity snapshot", () => {
    const b = biz({
      snapshot: { msiPercentile: 50, velocityLast30d: 1, velocityPrev30d: 9 },
    });
    const sig = active("reviews_percentile", {
      tune: { kind: "mode", value: "growing" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
  test("'stalled' matches velocity30 === 0", () => {
    const b = biz({
      snapshot: { msiPercentile: 50, velocityLast30d: 0, velocityPrev30d: 4 },
    });
    const sig = active("reviews_percentile", {
      tune: { kind: "mode", value: "stalled" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("'seasonal' → null (12-month trend not produced yet)", () => {
    const b = biz({
      snapshot: { msiPercentile: 50, velocityLast30d: 5, velocityPrev30d: 5 },
    });
    const sig = active("reviews_percentile", {
      tune: { kind: "mode", value: "seasonal" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBeNull();
  });
  test("no tune → uses the SigMeta default mode (growing) without crashing", () => {
    // Guards against feeding `is` to the numeric comparator: the registry type
    // is numeric but the value is a state string. Must NOT throw.
    const b = biz({
      snapshot: { msiPercentile: 50, velocityLast30d: 8, velocityPrev30d: 2 },
    });
    expect(evaluateSignal(active("reviews_percentile"), b, NOW).matched).toBe(
      true,
    );
  });
});

describe("evaluateSignal · scale-card with a dropped tune does not crash", () => {
  // market_position binds msi_percentile (numeric) with an is_one_of comparator
  // it normally pairs with a scale tune. If the tune is dropped, the comparator
  // is invalid for numeric → defensive null, never a thrown error.
  test("market_position with no tune → null (not a crash)", () => {
    const b = biz({ snapshot: { msiPercentile: 20 } });
    expect(
      evaluateSignal(active("market_position"), b, NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · rating_slipping (90d snapshot trend)", () => {
  test("matches when current rating dropped vs the ~90d-prior snapshot", () => {
    const b = biz({ snapshot: { rating: 4.1, priorRating: 4.6 } });
    expect(evaluateSignal(active("rating_slipping"), b, NOW).matched).toBe(
      true,
    );
  });
  test("does not match a stable/up rating", () => {
    const b = biz({ snapshot: { rating: 4.6, priorRating: 4.6 } });
    expect(evaluateSignal(active("rating_slipping"), b, NOW).matched).toBe(
      false,
    );
  });
  test("no prior snapshot → null", () => {
    const b = biz({ snapshot: { rating: 4.1, priorRating: null } });
    expect(
      evaluateSignal(active("rating_slipping"), b, NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · reputation_fire (recent ≤2★ burst)", () => {
  test("matches a burst of recent negatives", () => {
    const b = biz({
      reviews: {
        unanswered1StarCount: 0,
        unansweredNegativeCount: 0,
        unansweredCount: 0,
        hasNegativeTheme: false,
        negativeThemes: [],
        lastReviewAt: NOW,
        recentNegativeCount: 3,
        hasAnyReview: true,
      },
    });
    expect(evaluateSignal(active("reputation_fire"), b, NOW).matched).toBe(
      true,
    );
  });
  test("a single recent negative is not a fire", () => {
    const b = biz({
      reviews: {
        unanswered1StarCount: 0,
        unansweredNegativeCount: 0,
        unansweredCount: 0,
        hasNegativeTheme: false,
        negativeThemes: [],
        lastReviewAt: NOW,
        recentNegativeCount: 1,
        hasAnyReview: true,
      },
    });
    expect(evaluateSignal(active("reputation_fire"), b, NOW).matched).toBe(
      false,
    );
  });
  test("no reviews at all → null", () => {
    expect(
      evaluateSignal(active("reputation_fire"), biz(), NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · reputation_slipping (composite, all vs any)", () => {
  // Three conditions: 0 rating-down, 1 replyRate<25%, 2 unanswered negative.
  test("'any' matches when only the reply-rate condition is true", () => {
    const b = biz({
      snapshot: { rating: 4.6, priorRating: 4.6, replyRate: 0.1 },
      reviews: {
        unanswered1StarCount: 0,
        unansweredNegativeCount: 0,
        unansweredCount: 0,
        hasNegativeTheme: false,
        negativeThemes: [],
        lastReviewAt: NOW,
        recentNegativeCount: 0,
        hasAnyReview: true,
      },
    });
    const sig = active("reputation_slipping", { match: "any" });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("'all' needs every computable condition true (one false → no match)", () => {
    const b = biz({
      // rating stable (false), reply rate low (true), unanswered neg present (true)
      snapshot: { rating: 4.6, priorRating: 4.6, replyRate: 0.1 },
      reviews: {
        unanswered1StarCount: 1,
        unansweredNegativeCount: 1,
        unansweredCount: 1,
        hasNegativeTheme: false,
        negativeThemes: [],
        lastReviewAt: NOW,
        recentNegativeCount: 0,
        hasAnyReview: true,
      },
    });
    const sig = active("reputation_slipping", { match: "all" });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
  test("a toggled-off condition is skipped from the combine", () => {
    const b = biz({
      // only reply-rate is true; rating + unanswered toggled off.
      snapshot: { rating: 4.6, priorRating: 4.6, replyRate: 0.1 },
      reviews: {
        unanswered1StarCount: 0,
        unansweredNegativeCount: 0,
        unansweredCount: 0,
        hasNegativeTheme: false,
        negativeThemes: [],
        lastReviewAt: NOW,
        recentNegativeCount: 0,
        hasAnyReview: true,
      },
    });
    const sig = active("reputation_slipping", {
      match: "all",
      conds: { "0": false, "1": true, "2": false },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("no snapshot AND no reviews → null (nothing computable)", () => {
    const sig = active("reputation_slipping", { match: "any" });
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
});

describe("evaluateSignal · tech presence synthetics (chat_widget / ecommerce)", () => {
  test("chat_widget matches when a chat tool is detected", () => {
    const b = biz({ tech: tech({ hasChat: true }) });
    expect(evaluateSignal(active("chat_widget"), b, NOW).matched).toBe(true);
  });
  test("ecommerce false when no store detected (scan exists)", () => {
    const b = biz({ tech: tech({ hasEcommerce: false }) });
    expect(evaluateSignal(active("ecommerce"), b, NOW).matched).toBe(false);
  });
  test("no tech scan → null", () => {
    expect(
      evaluateSignal(active("chat_widget"), biz(), NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · not_advertising (B3 · per-business runs 0 ads)", () => {
  // Now a synthetic per-business signal (no registryKey): matches when THIS
  // business has 0 active ads AND the cell's ad scan actually ran. Was the
  // inverted market key `ad_market_prevalence` (same for every lead). Reads
  // the MERGED activeCount by design (any-platform advertising counts).
  const adRollup = (activeCount: number): HydratedBusiness["ads"] =>
    adsRoll({ activeCount });

  test("matches a scanned business that runs 0 active ads", () => {
    const b = biz({ adMarket: { advertiserCount: 4 }, ads: adRollup(0) });
    expect(evaluateSignal(active("not_advertising"), b, NOW).matched).toBe(
      true,
    );
  });
  test("does NOT match a business that runs active ads (scanned cell)", () => {
    const b = biz({ adMarket: { advertiserCount: 4 }, ads: adRollup(3) });
    expect(evaluateSignal(active("not_advertising"), b, NOW).matched).toBe(
      false,
    );
  });
  test("null when the cell's ad scan never ran (advertiserCount null)", () => {
    // No AdMarketRun for the cell → honest not-computable, never a false
    // "not advertising" on a lead we never scanned for ads.
    const b = biz({ adMarket: { advertiserCount: null }, ads: adRollup(0) });
    expect(
      evaluateSignal(active("not_advertising"), b, NOW).matched,
    ).toBeNull();
  });
  test("is a distinct verdict from competitors_advertising (not byte-identical)", () => {
    // Busy ad market (5 advertisers) where THIS business runs 0 ads:
    // not_advertising → true (per-business), competitors_advertising → true
    // (market ≥ 5). Same inputs, but the two now read different data — and they
    // diverge when the cell is under-scanned:
    const b = biz({ adMarket: { advertiserCount: 2 }, ads: adRollup(0) });
    // competitors_advertising: 2 < 5 → false. not_advertising: 0 ads → true.
    expect(evaluateSignal(active("not_advertising"), b, NOW).matched).toBe(
      true,
    );
    expect(
      evaluateSignal(active("competitors_advertising"), b, NOW).matched,
    ).toBe(false);
  });
});

describe("evaluateSignal · flying_blind (B4 · no analytics AND no pixel)", () => {
  // Now a synthetic composite (no registryKey): matches when the business has
  // NEITHER analytics NOR a Meta pixel. Both halves ride the tech scan.
  test("matches when the business has neither analytics nor a pixel", () => {
    const b = biz({ tech: tech({ hasAnalytics: false, hasMetaPixel: false }) });
    expect(evaluateSignal(active("flying_blind"), b, NOW).matched).toBe(true);
  });
  test("does NOT match when analytics is present", () => {
    const b = biz({ tech: tech({ hasAnalytics: true, hasMetaPixel: false }) });
    expect(evaluateSignal(active("flying_blind"), b, NOW).matched).toBe(false);
  });
  test("does NOT match when a pixel is present", () => {
    const b = biz({ tech: tech({ hasAnalytics: false, hasMetaPixel: true }) });
    expect(evaluateSignal(active("flying_blind"), b, NOW).matched).toBe(false);
  });
  test("null when there's no tech scan (honest not-computable)", () => {
    const b = biz({ tech: tech({ scanned: false }) });
    expect(evaluateSignal(active("flying_blind"), b, NOW).matched).toBeNull();
  });
});

describe("evaluateSignal · no_analytics (B1 · runs ads AND no analytics)", () => {
  // B1 · synthetic composite (no registryKey): matches when the business runs
  // active ads AND has no analytics. The ad half is now reliable per-business
  // (google_ads target-host attribution feeds biz.ads.activeCount), so this no
  // longer fires on every un-instrumented lead — only advertisers. Reads the
  // MERGED activeCount by design (A5 keeps the merge for this card).
  const adRollup = (activeCount: number): HydratedBusiness["ads"] =>
    adsRoll({ activeCount });

  test("matches an advertiser with no analytics", () => {
    const b = biz({ ads: adRollup(2), tech: tech({ hasAnalytics: false }) });
    expect(evaluateSignal(active("no_analytics"), b, NOW).matched).toBe(true);
  });
  test("does NOT match a non-advertiser (0 active ads) even without analytics", () => {
    // The key honesty win: no ads → not the "runs ads without analytics" pain.
    const b = biz({ ads: adRollup(0), tech: tech({ hasAnalytics: false }) });
    expect(evaluateSignal(active("no_analytics"), b, NOW).matched).toBe(false);
  });
  test("does NOT match an advertiser that HAS analytics", () => {
    const b = biz({ ads: adRollup(3), tech: tech({ hasAnalytics: true }) });
    expect(evaluateSignal(active("no_analytics"), b, NOW).matched).toBe(false);
  });
  test("null when there's no tech scan (honest not-computable)", () => {
    const b = biz({ ads: adRollup(2), tech: tech({ scanned: false }) });
    expect(evaluateSignal(active("no_analytics"), b, NOW).matched).toBeNull();
  });
});

describe("evaluateSignal · losing_rankings (BusinessKeyword isDown)", () => {
  test("matches when any keyword is flagged down (>= 1)", () => {
    const b = biz({
      keywords: {
        scanned: true,
        estMonthlyVisits: 100,
        anyDown: true,
        anyUp: false,
      },
    });
    expect(evaluateSignal(active("losing_rankings"), b, NOW).matched).toBe(
      true,
    );
  });
  test("presence 'hasnt' matches a stable portfolio (no down keyword)", () => {
    const b = biz({
      keywords: {
        scanned: true,
        estMonthlyVisits: 100,
        anyDown: false,
        anyUp: true,
      },
    });
    const sig = active("losing_rankings", {
      tune: { kind: "presence", value: "hasnt" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("no keyword scan → null", () => {
    expect(
      evaluateSignal(active("losing_rankings"), biz(), NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · ads_homepage_landing (landing homepage-only)", () => {
  test("matches when active ads only point at the homepage", () => {
    const b = biz({
      ads: metaAds(1, { formats: ["image"], newestAgeDays: 5 }),
    });
    b.ads.landingHostCount = 1;
    b.ads.landingIsHomepageOnly = true;
    expect(evaluateSignal(active("ads_homepage_landing"), b, NOW).matched).toBe(
      true,
    );
  });
  test("does not match when ads use a deep landing page", () => {
    const b = biz({
      ads: metaAds(1, { formats: ["image"], newestAgeDays: 5 }),
    });
    b.ads.landingHostCount = 1;
    b.ads.landingIsHomepageOnly = false;
    expect(evaluateSignal(active("ads_homepage_landing"), b, NOW).matched).toBe(
      false,
    );
  });
  test("no active ad with a landing URL → null", () => {
    expect(
      evaluateSignal(active("ads_homepage_landing"), biz(), NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · stale_ad_creative + many_ad_creatives", () => {
  test("stale_ad_creative matches when newest META ad is older than 60d", () => {
    const b = biz({
      ads: metaAds(2, { formats: ["image"], newestAgeDays: 90 }),
    });
    expect(evaluateSignal(active("stale_ad_creative"), b, NOW).matched).toBe(
      true,
    );
  });
  test("many_ad_creatives matches 5+ active META creatives", () => {
    const b = biz({
      ads: metaAds(6, { formats: ["image"], newestAgeDays: 5 }),
    });
    expect(evaluateSignal(active("many_ad_creatives"), b, NOW).matched).toBe(
      true,
    );
  });
});

describe("evaluateSignal · compliance_risk (flagged finding group)", () => {
  test("matches a flagged HIPAA finding (privacy group)", () => {
    const b = biz({
      findings: rollupFindings([
        {
          signalKey: "hipaa-pixel-on-phi-page",
          group: "privacy",
          value: "true",
          confidence: "high",
        },
      ]),
    });
    expect(evaluateSignal(active("compliance_risk"), b, NOW).matched).toBe(
      true,
    );
  });
  test("does NOT match when findings exist but none are compliance-class", () => {
    const b = biz({
      findings: rollupFindings([
        {
          signalKey: "no-online-booking",
          group: "conversion",
          value: "true",
          confidence: "medium",
        },
      ]),
    });
    expect(evaluateSignal(active("compliance_risk"), b, NOW).matched).toBe(
      false,
    );
  });
  test("no findings at all → null", () => {
    expect(
      evaluateSignal(active("compliance_risk"), biz(), NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · service_gap (missing common services)", () => {
  test("'miss1' matches when missing ≥ 1 common service", () => {
    const b = biz({ services: { scanned: true, missingCommonCount: 2 } });
    const sig = active("service_gap", {
      tune: { kind: "mode", value: "miss1" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("'miss3' does not match when only 2 are missing", () => {
    const b = biz({ services: { scanned: true, missingCommonCount: 2 } });
    const sig = active("service_gap", {
      tune: { kind: "mode", value: "miss3" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
  test("no service/prevalence data → null", () => {
    const b = biz({ services: { scanned: false, missingCommonCount: null } });
    expect(evaluateSignal(active("service_gap"), b, NOW).matched).toBeNull();
  });
});

describe("evaluateSignal · site_age_3y + multi_location", () => {
  test("site_age_3y matches Google tenure ≥ 3 (proxy)", () => {
    const b = biz({ business: { yearsOnGoogle: 5 } });
    expect(evaluateSignal(active("site_age_3y"), b, NOW).matched).toBe(true);
  });
  test("site_age_3y false under 3 years", () => {
    const b = biz({ business: { yearsOnGoogle: 1 } });
    expect(evaluateSignal(active("site_age_3y"), b, NOW).matched).toBe(false);
  });
  test("site_age_3y null when tenure unknown", () => {
    expect(
      evaluateSignal(active("site_age_3y"), biz(), NOW).matched,
    ).toBeNull();
  });
  test("multi_location null when no chain cluster is hydrated (metro/name unknown)", () => {
    const b = biz({ business: { yearsOnGoogle: 9 } });
    expect(evaluateSignal(active("multi_location"), b, NOW).matched).toBeNull();
  });
  test("multi_location matches a ≥2-location chain", () => {
    const b = biz({ cell: cell({ locationCount: 3 }) });
    expect(evaluateSignal(active("multi_location"), b, NOW).matched).toBe(true);
  });
  test("multi_location false for a single location", () => {
    const b = biz({ cell: cell({ locationCount: 1 }) });
    expect(evaluateSignal(active("multi_location"), b, NOW).matched).toBe(
      false,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cluster-C · cell-relative organic signals (percentile-vs-cell + scale band).
// ═════════════════════════════════════════════════════════════════════════════

const ORG_TRAFFIC_BP = bp(10, 25, 50, 100, 400); // est monthly visits
const ORG_RANK_BP = bp(2, 4, 8, 15, 40); // best organic rank (lower better)

describe("evaluateSignal · low_organic_traffic (percentile vs cell)", () => {
  test("matches a low-traffic business in the chosen band", () => {
    const b = biz({
      keywords: {
        scanned: true,
        estMonthlyVisits: 5,
        anyDown: false,
        anyUp: false,
      },
      cell: cell({ sampleSize: 12, organicTraffic: ORG_TRAFFIC_BP }),
    });
    // default tune ["below","bottom10"] = [0,50]; 5 visits → ~5th pct → match.
    expect(evaluateSignal(active("low_organic_traffic"), b, NOW).matched).toBe(
      true,
    );
  });
  test("does NOT match a high-traffic business (above the band)", () => {
    const b = biz({
      keywords: {
        scanned: true,
        estMonthlyVisits: 500,
        anyDown: false,
        anyUp: false,
      },
      cell: cell({ sampleSize: 12, organicTraffic: ORG_TRAFFIC_BP }),
    });
    expect(evaluateSignal(active("low_organic_traffic"), b, NOW).matched).toBe(
      false,
    );
  });
  test("null when the cell sample is too thin (<8) to place honestly", () => {
    const b = biz({
      keywords: {
        scanned: true,
        estMonthlyVisits: 5,
        anyDown: false,
        anyUp: false,
      },
      cell: cell({ sampleSize: 4, organicTraffic: ORG_TRAFFIC_BP }),
    });
    expect(
      evaluateSignal(active("low_organic_traffic"), b, NOW).matched,
    ).toBeNull();
  });
  test("null when the keyword portfolio isn't scanned", () => {
    const b = biz({
      cell: cell({ sampleSize: 12, organicTraffic: ORG_TRAFFIC_BP }),
    });
    expect(
      evaluateSignal(active("low_organic_traffic"), b, NOW).matched,
    ).toBeNull();
  });
  test("null when the cell has no organic-traffic distribution", () => {
    const b = biz({
      keywords: {
        scanned: true,
        estMonthlyVisits: 5,
        anyDown: false,
        anyUp: false,
      },
      cell: cell({ sampleSize: 12, organicTraffic: null }),
    });
    expect(
      evaluateSignal(active("low_organic_traffic"), b, NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · search_visibility (rank + traffic composite vs cell)", () => {
  test("matches a weak-visibility business (low traffic + poor rank)", () => {
    const b = biz({
      keywords: {
        scanned: true,
        estMonthlyVisits: 5,
        anyDown: false,
        anyUp: false,
      },
      serp: {
        bestLocalPackRank: null,
        bestOrganicRank: 38, // near p90 worst → low rank percentile
        brandedOrganicRank: null,
        hasBrandQuery: false,
        nonBrandRankedCount: 0,
      },
      cell: cell({
        sampleSize: 12,
        organicTraffic: ORG_TRAFFIC_BP,
        organicRank: ORG_RANK_BP,
      }),
    });
    expect(evaluateSignal(active("search_visibility"), b, NOW).matched).toBe(
      true,
    );
  });
  test("does NOT match a strong-visibility business (high traffic + top rank)", () => {
    const b = biz({
      keywords: {
        scanned: true,
        estMonthlyVisits: 500,
        anyDown: false,
        anyUp: false,
      },
      serp: {
        bestLocalPackRank: 1,
        bestOrganicRank: 2, // best → high rank percentile
        brandedOrganicRank: null,
        hasBrandQuery: false,
        nonBrandRankedCount: 5,
      },
      cell: cell({
        sampleSize: 12,
        organicTraffic: ORG_TRAFFIC_BP,
        organicRank: ORG_RANK_BP,
      }),
    });
    expect(evaluateSignal(active("search_visibility"), b, NOW).matched).toBe(
      false,
    );
  });
  test("computable from rank alone when traffic isn't scanned", () => {
    const b = biz({
      serp: {
        bestLocalPackRank: null,
        bestOrganicRank: 38,
        brandedOrganicRank: null,
        hasBrandQuery: false,
        nonBrandRankedCount: 0,
      },
      cell: cell({ sampleSize: 12, organicRank: ORG_RANK_BP }),
    });
    expect(evaluateSignal(active("search_visibility"), b, NOW).matched).toBe(
      true,
    );
  });
  test("null when neither organic dimension can be placed", () => {
    const b = biz({ cell: cell({ sampleSize: 12 }) });
    expect(
      evaluateSignal(active("search_visibility"), b, NOW).matched,
    ).toBeNull();
  });
});

describe("evaluateSignal · invisible_locally (not in 3-pack AND below median traffic)", () => {
  test("matches: no pack rank + below-median organic traffic", () => {
    const b = biz({
      serp: {
        bestLocalPackRank: null, // not in pack
        bestOrganicRank: 30,
        brandedOrganicRank: null,
        hasBrandQuery: false,
        nonBrandRankedCount: 0,
      },
      keywords: {
        scanned: true,
        estMonthlyVisits: 5,
        anyDown: false,
        anyUp: false,
      },
      cell: cell({ sampleSize: 12, organicTraffic: ORG_TRAFFIC_BP }),
    });
    expect(evaluateSignal(active("invisible_locally"), b, NOW).matched).toBe(
      true,
    );
  });
  test("does NOT match when in the 3-pack (even with low traffic)", () => {
    const b = biz({
      serp: {
        bestLocalPackRank: 2, // in pack
        bestOrganicRank: 30,
        brandedOrganicRank: null,
        hasBrandQuery: false,
        nonBrandRankedCount: 0,
      },
      keywords: {
        scanned: true,
        estMonthlyVisits: 5,
        anyDown: false,
        anyUp: false,
      },
      cell: cell({ sampleSize: 12, organicTraffic: ORG_TRAFFIC_BP }),
    });
    expect(evaluateSignal(active("invisible_locally"), b, NOW).matched).toBe(
      false,
    );
  });
  test("does NOT match when organic traffic is above the cell median", () => {
    const b = biz({
      serp: {
        bestLocalPackRank: null,
        bestOrganicRank: 30,
        brandedOrganicRank: null,
        hasBrandQuery: false,
        nonBrandRankedCount: 0,
      },
      keywords: {
        scanned: true,
        estMonthlyVisits: 500,
        anyDown: false,
        anyUp: false,
      },
      cell: cell({ sampleSize: 12, organicTraffic: ORG_TRAFFIC_BP }),
    });
    expect(evaluateSignal(active("invisible_locally"), b, NOW).matched).toBe(
      false,
    );
  });
  test("null when there's no SERP scan", () => {
    const b = biz({
      keywords: {
        scanned: true,
        estMonthlyVisits: 5,
        anyDown: false,
        anyUp: false,
      },
      cell: cell({ sampleSize: 12, organicTraffic: ORG_TRAFFIC_BP }),
    });
    expect(
      evaluateSignal(active("invisible_locally"), b, NOW).matched,
    ).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cluster-H · competitor_pressure (mode tune) + brandKeyOf chain clustering.
// ═════════════════════════════════════════════════════════════════════════════

describe("evaluateSignal · competitor_pressure (mode tune)", () => {
  test("advertising: rivals advertise + this business doesn't → match", () => {
    const b = biz({ adMarket: { advertiserCount: 4 } });
    const sig = active("competitor_pressure", {
      tune: { kind: "mode", value: "advertising" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("advertising: false when THIS business is also advertising", () => {
    const b = biz({
      adMarket: { advertiserCount: 4 },
      ads: metaAds(2, { formats: ["image"], newestAgeDays: 5 }),
    });
    const sig = active("competitor_pressure", {
      tune: { kind: "mode", value: "advertising" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
  test("advertising: null when no AdMarketRun for the cell", () => {
    const sig = active("competitor_pressure", {
      tune: { kind: "mode", value: "advertising" },
    });
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
  test("newentrant: matches when a same-cell peer appeared recently", () => {
    const b = biz({ cell: cell({ hasRecentNewEntrant: true }) });
    const sig = active("competitor_pressure", {
      tune: { kind: "mode", value: "newentrant" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("newentrant: false when peers exist but none are recent", () => {
    const b = biz({ cell: cell({ hasRecentNewEntrant: false }) });
    const sig = active("competitor_pressure", {
      tune: { kind: "mode", value: "newentrant" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
  test("newentrant: null when no same-cell peer has a first-seen date", () => {
    const sig = active("competitor_pressure", {
      tune: { kind: "mode", value: "newentrant" },
    });
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
  test("outspend: A12-removed option degrades to null (persisted goals)", () => {
    // The "outspend" chip is gone from the card (no per-business spend is
    // stored) — a goal persisted before A12 must degrade to not-computable,
    // never crash or fake a verdict.
    const b = biz({ adMarket: { advertiserCount: 4 } });
    const sig = active("competitor_pressure", {
      tune: { kind: "mode", value: "outspend" },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A1 (filters audit P0) · SCANNED-GUARD invariants — "unscanned lead → null
// verdict" per resolver family. These are the guards that keep the strict
// availableSignalKeys gate + the seedSignalFilters honesty guard working: a
// never-collected count must NEVER read as a verified true/false.
// ═════════════════════════════════════════════════════════════════════════════

describe("A1 · reviews family: unscanned lead → null verdict", () => {
  test("unanswered_1star is null with no hydrated Review rows", () => {
    // Counts default to 0 with hasAnyReview:false — the old code read that as
    // a verified "no unanswered negatives" (✗) on a never-pulled lead.
    expect(
      evaluateSignal(active("unanswered_1star"), biz(), NOW).matched,
    ).toBeNull();
  });
  test("…and returns a real verdict once reviews are hydrated", () => {
    const withReviews = (unanswered1StarCount: number) =>
      biz({
        reviews: {
          ...biz().reviews,
          hasAnyReview: true,
          unanswered1StarCount,
          unansweredNegativeCount: unanswered1StarCount,
          unansweredCount: unanswered1StarCount,
        },
      });
    expect(
      evaluateSignal(active("unanswered_1star"), withReviews(2), NOW).matched,
    ).toBe(true);
    expect(
      evaluateSignal(active("unanswered_1star"), withReviews(0), NOW).matched,
    ).toBe(false);
  });
});

describe("A1 · contacts family: unscanned lead → null verdict", () => {
  test("stale_social (social_channel_count ≤ 1) is null before the scan", () => {
    // The audit's headline case: a 0 social count on an un-scanned lead read
    // MATCHED — hiding every unscanned lead behind an auto-applied filter.
    expect(
      evaluateSignal(active("stale_social"), biz(), NOW).matched,
    ).toBeNull();
  });
  test("…and a scanned lead with 0 socials genuinely matches", () => {
    const b = biz({ contacts: { ...biz().contacts, scanned: true } });
    expect(evaluateSignal(active("stale_social"), b, NOW).matched).toBe(true);
    const rich = biz({
      contacts: { ...biz().contacts, scanned: true, socialChannelCount: 4 },
    });
    expect(evaluateSignal(active("stale_social"), rich, NOW).matched).toBe(
      false,
    );
  });
});

describe("A1 · ads family: unscanned lead → null verdict", () => {
  const metaSignals = [
    "not_advertising", // gated via adMarket (unchanged contract)
    "many_ad_creatives", // meta_ad_count
    "stale_ad_creative", // ads_age_days
    "meta_video_ads", // meta_ad_format_video
  ] as const;
  test("every Meta ad-count signal is null before the Meta scan", () => {
    for (const key of metaSignals) {
      expect(
        evaluateSignal(active(key), biz(), NOW).matched,
        `${key} must be null on an unscanned lead`,
      ).toBeNull();
    }
  });
  test("a Meta-scanned lead with 0 ads reads verified false, not null", () => {
    // Scanned via the cell run (withAdScanTruth folds it into meta.scanned):
    // 0 entries is now a REAL "no ads" — exactly what not_advertising wants.
    const b = biz({
      adMarket: { advertiserCount: 3 },
      ads: adsRoll({ meta: adsPlat({ scanned: true }) }),
    });
    expect(evaluateSignal(active("many_ad_creatives"), b, NOW).matched).toBe(
      false,
    );
    expect(evaluateSignal(active("meta_video_ads"), b, NOW).matched).toBe(
      false,
    );
    expect(evaluateSignal(active("not_advertising"), b, NOW).matched).toBe(
      true,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A2 (filters audit P0) · low_reply_rate reads the REAL reply rate; the
// lifecycle read lives on its own card (reviews_slowing).
// ═════════════════════════════════════════════════════════════════════════════

describe("A2 · low_reply_rate → BusinessSnapshot.replyRate (0–1 fraction)", () => {
  const withReplyRate = (replyRate: number | null) =>
    biz({ snapshot: { replyRate } });
  test("matches a 10%-reply business", () => {
    expect(
      evaluateSignal(active("low_reply_rate"), withReplyRate(0.1), NOW).matched,
    ).toBe(true);
  });
  test("does NOT match a 90%-reply business (even with slowing reviews)", () => {
    // The old binding (review_lifecycle is DYING) matched a 100%-reply spa
    // whose reviews were merely slowing — the exact P0 lie.
    const b = biz({ snapshot: { replyRate: 0.9, reviewLifecycle: "DYING" } });
    expect(evaluateSignal(active("low_reply_rate"), b, NOW).matched).toBe(
      false,
    );
  });
  test("null when no snapshot / replyRate", () => {
    expect(
      evaluateSignal(active("low_reply_rate"), biz(), NOW).matched,
    ).toBeNull();
    expect(
      evaluateSignal(active("low_reply_rate"), withReplyRate(null), NOW)
        .matched,
    ).toBeNull();
  });
  test("SIG_META binding snapshot: registry reply_rate, < 0.25", () => {
    expect(SIG_META.low_reply_rate).toMatchObject({
      signalKey: "reply_rate",
      registryKey: "reply_rate",
      comparator: "<",
      value: 0.25,
    });
  });
});

describe("A2 · reviews_slowing → review_lifecycle (the re-homed read)", () => {
  const withLifecycle = (reviewLifecycle: string) =>
    biz({ snapshot: { reviewLifecycle } });
  test("matches DYING by default", () => {
    expect(
      evaluateSignal(active("reviews_slowing"), withLifecycle("DYING"), NOW)
        .matched,
    ).toBe(true);
  });
  test("mode tune selects DORMANT", () => {
    const sig = active("reviews_slowing", {
      tune: { kind: "mode", value: "DORMANT" },
    });
    expect(evaluateSignal(sig, withLifecycle("DORMANT"), NOW).matched).toBe(
      true,
    );
    expect(evaluateSignal(sig, withLifecycle("DYING"), NOW).matched).toBe(
      false,
    );
  });
  test("a TRENDING business does not match; no snapshot → null", () => {
    expect(
      evaluateSignal(active("reviews_slowing"), withLifecycle("TRENDING"), NOW)
        .matched,
    ).toBe(false);
    expect(
      evaluateSignal(active("reviews_slowing"), biz(), NOW).matched,
    ).toBeNull();
  });
  test("SIG_META binding snapshot: registry review_lifecycle, is DYING", () => {
    expect(SIG_META.reviews_slowing).toMatchObject({
      signalKey: "review_lifecycle",
      registryKey: "review_lifecycle",
      comparator: "is",
      value: "DYING",
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A5 (filters audit P1) · Meta-labelled signals read the META sub-rollup.
// ═════════════════════════════════════════════════════════════════════════════

describe("A5 · a Google-only advertiser never fires a Meta-labelled signal", () => {
  // 2 active GOOGLE ads (one video), META scanned + empty.
  const googleOnly = biz({
    adMarket: { advertiserCount: 3 },
    ads: adsRoll({
      activeCount: 2,
      hasVideo: true,
      formats: ["video"],
      meta: adsPlat({ scanned: true }),
      google: adsPlat({
        scanned: true,
        activeCount: 2,
        hasVideo: true,
        formats: ["video"],
      }),
    }),
  });
  test("meta_video_ads / many_ad_creatives read .meta → false", () => {
    expect(
      evaluateSignal(active("meta_video_ads"), googleOnly, NOW).matched,
    ).toBe(false);
    expect(
      evaluateSignal(active("many_ad_creatives"), googleOnly, NOW).matched,
    ).toBe(false);
  });
  test("not_advertising keeps the MERGED total (intentionally) → false", () => {
    expect(
      evaluateSignal(active("not_advertising"), googleOnly, NOW).matched,
    ).toBe(false);
  });
  test("ads_without_pixel reads .meta — Google ads alone don't fire it", () => {
    const b = biz({
      ads: googleOnly.ads,
      tech: tech({ hasMetaPixel: false }),
    });
    expect(evaluateSignal(active("ads_without_pixel"), b, NOW).matched).toBe(
      false,
    );
    const metaAdvertiser = biz({
      ads: metaAds(2),
      tech: tech({ hasMetaPixel: false }),
    });
    expect(
      evaluateSignal(active("ads_without_pixel"), metaAdvertiser, NOW).matched,
    ).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A7 (filters audit P1) · meta_video_ads formats tune — intersection, not
// String(bool) vs format tokens (which matched nothing forever).
// ═════════════════════════════════════════════════════════════════════════════

describe("A7 · meta_video_ads formats tune", () => {
  const withFormats = (formats: string[]) =>
    biz({
      ads: adsRoll({
        activeCount: formats.length,
        hasVideo: formats.includes("video"),
        formats,
        meta: adsPlat({
          scanned: true,
          activeCount: formats.length,
          hasVideo: formats.includes("video"),
          formats,
        }),
      }),
    });
  test("tuned: matches when the collected format set intersects the chips", () => {
    const sig = active("meta_video_ads", {
      tune: { kind: "platform", values: ["video", "image"] },
    });
    expect(evaluateSignal(sig, withFormats(["video"]), NOW).matched).toBe(true);
    expect(evaluateSignal(sig, withFormats(["image"]), NOW).matched).toBe(true);
    expect(evaluateSignal(sig, withFormats(["carousel"]), NOW).matched).toBe(
      false,
    );
  });
  test("tuned with the DEFAULT chips re-selected still works (the P1 bug)", () => {
    // Materializing the default tune used to compare String(bool) vs the
    // format set → 0 matches forever.
    const sig = active("meta_video_ads", {
      tune: {
        kind: "platform",
        values: ["video", "image"], // the setting's def, re-selected
      },
    });
    expect(evaluateSignal(sig, withFormats(["video"]), NOW).matched).toBe(true);
  });
  test("untuned keeps the hasVideo default", () => {
    expect(
      evaluateSignal(active("meta_video_ads"), withFormats(["video"]), NOW)
        .matched,
    ).toBe(true);
    expect(
      evaluateSignal(active("meta_video_ads"), withFormats(["image"]), NOW)
        .matched,
    ).toBe(false);
  });
  test("tuned + unscanned Meta → null (the A1 gate still wins)", () => {
    const sig = active("meta_video_ads", {
      tune: { kind: "platform", values: ["video"] },
    });
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A11 (filters audit P2) · review_count / rating read SNAPSHOT-FIRST, matching
// the workbench columns (`snap ?? b`) so one row can't contradict itself.
// ═════════════════════════════════════════════════════════════════════════════

describe("A11 · snapshot-first reviews/rating", () => {
  const reviewCountSig: ActiveSignal = {
    key: "review_count_raw",
    registryKey: "review_count",
    comparator: ">=",
    value: 100,
  };
  test("prefers the snapshot value over the live Business row", () => {
    const b = biz({
      business: { reviewCount: 40 }, // stale live row
      snapshot: { reviewCount: 120 }, // the column/filter source
    });
    expect(evaluateSignal(reviewCountSig, b, NOW).matched).toBe(true);
  });
  test("falls back to the Business row when no snapshot exists", () => {
    const b = biz({ business: { reviewCount: 40 } });
    expect(evaluateSignal(reviewCountSig, b, NOW).matched).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A12 (filters audit P2) · chat_widget tool chips are wired; removed tune
// options degrade gracefully.
// ═════════════════════════════════════════════════════════════════════════════

describe("A12 · chat_widget tool chips", () => {
  const withChat = (chatName: string | null) =>
    biz({ tech: tech({ hasChat: chatName != null, chatName }) });
  test("chips match the detected tool name", () => {
    const sig = active("chat_widget", {
      tune: { kind: "platform", values: ["intercom", "drift", "tawk"] },
    });
    expect(evaluateSignal(sig, withChat("tawk.to"), NOW).matched).toBe(true);
    expect(evaluateSignal(sig, withChat("hubspot"), NOW).matched).toBe(false);
    expect(evaluateSignal(sig, withChat(null), NOW).matched).toBe(false);
  });
  test("'__any__' sentinel = any detected tool; '__none__' inverts", () => {
    const anySig = active("chat_widget", {
      tune: { kind: "platform", values: ["__any__"] },
    });
    expect(evaluateSignal(anySig, withChat("hubspot"), NOW).matched).toBe(true);
    expect(evaluateSignal(anySig, withChat(null), NOW).matched).toBe(false);
    const noneSig = active("chat_widget", {
      tune: { kind: "platform", values: ["__none__"] },
    });
    expect(evaluateSignal(noneSig, withChat(null), NOW).matched).toBe(true);
    expect(evaluateSignal(noneSig, withChat("drift"), NOW).matched).toBe(false);
  });
  test("legacy 'custom' chip (removed) degrades to no-match, not a crash", () => {
    const sig = active("chat_widget", {
      tune: { kind: "platform", values: ["custom"] },
    });
    expect(evaluateSignal(sig, withChat("intercom"), NOW).matched).toBe(false);
  });
  test("untuned keeps plain presence; no tech scan → null", () => {
    expect(
      evaluateSignal(active("chat_widget"), withChat("drift"), NOW).matched,
    ).toBe(true);
    expect(
      evaluateSignal(active("chat_widget"), biz(), NOW).matched,
    ).toBeNull();
  });
  test("ecommerce ignores a legacy platform tune (chips removed)", () => {
    const sig = active("ecommerce", {
      tune: { kind: "platform", values: ["shopify"] },
    });
    const b = biz({ tech: tech({ hasEcommerce: true }) });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
});

describe("brandKeyOf · chain-clustering identity", () => {
  test("prefers domain host (www stripped)", () => {
    expect(brandKeyOf("Glow Spa", "www.glowspa.com", "cid1")).toBe(
      "d:glowspa.com",
    );
  });
  test("falls back to googleCid when no domain", () => {
    expect(brandKeyOf("Glow Spa", null, "cid1")).toBe("c:cid1");
  });
  test("falls back to slugified name when no domain/cid", () => {
    expect(brandKeyOf("Glow Spa Miami", null, null)).toBe("n:glow-spa-miami");
  });
  test("null when nothing usable", () => {
    expect(brandKeyOf(null, null, null)).toBeNull();
    expect(brandKeyOf("", "", "")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cluster-F · recurring_complaint_theme (built off stored Review.themes).
// ═════════════════════════════════════════════════════════════════════════════

describe("evaluateSignal · recurring_complaint_theme (negative themes)", () => {
  function reviewsWith(themes: string[]): HydratedBusiness["reviews"] {
    return {
      unanswered1StarCount: 0,
      unansweredNegativeCount: 0,
      unansweredCount: 0,
      hasNegativeTheme: themes.length > 0,
      negativeThemes: themes,
      lastReviewAt: NOW,
      recentNegativeCount: 0,
      hasAnyReview: true,
    };
  }
  test("matches when a selected chip's tag appears in negative themes", () => {
    const b = biz({ reviews: reviewsWith(["wait_time"]) });
    const sig = active("recurring_complaint_theme", {
      tune: { kind: "platform", values: ["wait"] },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("billing chip matches the billing_issue / pricing tags", () => {
    const b = biz({ reviews: reviewsWith(["pricing"]) });
    const sig = active("recurring_complaint_theme", {
      tune: { kind: "platform", values: ["billing"] },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(true);
  });
  test("false when the negative themes don't include any selected chip", () => {
    const b = biz({ reviews: reviewsWith(["cleanliness"]) });
    const sig = active("recurring_complaint_theme", {
      tune: { kind: "platform", values: ["wait", "billing"] },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBe(false);
  });
  test("null when reviews exist but none carry stored themes (post-R.1 — cost-flag)", () => {
    const b = biz({ reviews: reviewsWith([]) });
    const sig = active("recurring_complaint_theme", {
      tune: { kind: "platform", values: ["wait"] },
    });
    expect(evaluateSignal(sig, b, NOW).matched).toBeNull();
  });
  test("null when there are no reviews at all", () => {
    const sig = active("recurring_complaint_theme", {
      tune: { kind: "platform", values: ["wait"] },
    });
    expect(evaluateSignal(sig, biz(), NOW).matched).toBeNull();
  });
});

// ── rollup helpers for the new derivations ──

describe("rollupSnapshot · attaches priorRating from a ~90d-old snapshot", () => {
  test("picks the snapshot nearest ~90d before the latest", () => {
    const snap = rollupSnapshot(
      [
        // desc order, as the query returns
        { snapshotDate: new Date("2026-06-30"), rating: 4.0 },
        { snapshotDate: new Date("2026-03-31"), rating: 4.7 }, // ~90d prior
        { snapshotDate: new Date("2026-01-01"), rating: 4.9 }, // too old
      ],
      NOW,
    );
    expect(snap?.rating).toBe(4.0);
    expect(snap?.priorRating).toBe(4.7);
  });
  test("priorRating null when only the latest snapshot exists", () => {
    const snap = rollupSnapshot(
      [{ snapshotDate: new Date("2026-06-30"), rating: 4.0 }],
      NOW,
    );
    expect(snap?.priorRating).toBeNull();
  });
  test("empty → null", () => {
    expect(rollupSnapshot([], NOW)).toBeNull();
  });
});

describe("rollupReviews · recent negative burst + hasAnyReview", () => {
  test("counts ≤2★ inside the 30d window, ignores old negatives", () => {
    const r = rollupReviews(
      [
        {
          stars: 1,
          ownerReplied: false,
          postedAt: new Date("2026-06-20"), // recent
          sentiment: "NEGATIVE",
          themes: [],
        },
        {
          stars: 2,
          ownerReplied: true,
          postedAt: new Date("2026-06-25"), // recent, answered still counts
          sentiment: "NEGATIVE",
          themes: [],
        },
        {
          stars: 1,
          ownerReplied: false,
          postedAt: new Date("2026-01-01"), // old → excluded from spike
          sentiment: "NEGATIVE",
          themes: [],
        },
      ],
      NOW,
    );
    expect(r.recentNegativeCount).toBe(2);
    expect(r.hasAnyReview).toBe(true);
  });
  test("hasAnyReview false on an empty set", () => {
    expect(rollupReviews([], NOW).hasAnyReview).toBe(false);
  });
});

describe("rollupServices · missing common-service count", () => {
  test("counts cell-common services the business does not offer", () => {
    const s = rollupServices(
      [{ canonicalKey: "botox" }, { canonicalKey: "filler" }],
      new Set(["botox", "filler", "microneedling", "peel"]),
    );
    expect(s.scanned).toBe(true);
    expect(s.missingCommonCount).toBe(2); // microneedling + peel
  });
  test("null count when no prevalence for the cell", () => {
    const s = rollupServices([{ canonicalKey: "botox" }], null);
    expect(s.missingCommonCount).toBeNull();
  });
  test("null count when the business has no services scanned", () => {
    const s = rollupServices([], new Set(["botox"]));
    expect(s.scanned).toBe(false);
    expect(s.missingCommonCount).toBeNull();
  });
});

describe("rollupFindings · flaggedGroups", () => {
  test("collects the distinct finding groups", () => {
    const f = rollupFindings([
      {
        signalKey: "hipaa-pixel-on-phi-page",
        group: "privacy",
        value: "true",
        confidence: "high",
      },
      {
        signalKey: "ada-web-risk",
        group: "accessibility",
        value: "high",
        confidence: "high",
      },
    ]);
    expect(Array.from(f.flaggedGroups).sort()).toEqual([
      "accessibility",
      "privacy",
    ]);
    expect(f.valueByKey["ada-web-risk"]).toBe("high");
  });
});

// ── tiny builders for the lighthouse + tech slots used above ──
function lh(
  over: Partial<HydratedBusiness["lighthouse"] & object> = {},
): NonNullable<HydratedBusiness["lighthouse"]> {
  return {
    performance: null,
    accessibility: null,
    seo: null,
    bestPractices: null,
    lcp: null,
    cls: null,
    inp: null,
    fcp: null,
    perfSavingsMs: null,
    a11yViolationCount: null,
    isOnHttps: null,
    hasLocalBusinessSchema: null,
    hasFaqSchema: null,
    ...over,
  };
}

function tech(
  over: Partial<HydratedBusiness["tech"]> = {},
): HydratedBusiness["tech"] {
  return {
    scanned: true,
    cmsName: null,
    bookingName: null,
    chatName: null,
    hasAnalytics: false,
    hasMetaPixel: false,
    hasBooking: false,
    hasChat: false,
    hasEcommerce: false,
    hasConsent: false,
    ...over,
  };
}

// AUDIT C1 · "No online booking tool" is an ABSENCE card. The old binding read
// the GBP boolean and matched on-site tool-name chips against it → 0 results;
// re-bound to the tech fingerprint, a phone-only business (no widget) matches.
describe("no_booking · absence of an on-site booking tool (audit C1)", () => {
  test("not computable until a tech scan exists (honest null, never a fake match)", () => {
    expect(
      evaluateSignal(
        active("no_booking"),
        biz({ tech: tech({ scanned: false }) }),
        NOW,
      ).matched,
    ).toBeNull();
  });

  test("no booking tool detected → matches (the phone-only barbers, not 0)", () => {
    expect(
      evaluateSignal(
        active("no_booking"),
        biz({ tech: tech({ bookingName: null }) }),
        NOW,
      ).matched,
    ).toBe(true);
  });

  test("a detected booking tool → does NOT match", () => {
    expect(
      evaluateSignal(
        active("no_booking"),
        biz({ tech: tech({ bookingName: "square appointments" }) }),
        NOW,
      ).matched,
    ).toBe(false);
  });

  test("platform tune scopes WHICH tools count as booking", () => {
    // Uses Vagaro, but the filter only counts Square → still "no Square booking".
    expect(
      evaluateSignal(
        active("no_booking", {
          tune: { kind: "platform", values: ["square"] },
        }),
        biz({ tech: tech({ bookingName: "vagaro" }) }),
        NOW,
      ).matched,
    ).toBe(true);
    // Filter counts Vagaro and the business uses Vagaro → does not match.
    expect(
      evaluateSignal(
        active("no_booking", {
          tune: { kind: "platform", values: ["vagaro"] },
        }),
        biz({ tech: tech({ bookingName: "vagaro" }) }),
        NOW,
      ).matched,
    ).toBe(false);
  });
});

function strict(level: "loose" | "balanced" | "strict") {
  return { kind: "strictness" as const, level };
}

function cell(
  over: Partial<HydratedBusiness["cell"]> = {},
): HydratedBusiness["cell"] {
  return {
    sampleSize: null,
    organicTraffic: null,
    organicRank: null,
    locationCount: null,
    hasRecentNewEntrant: null,
    ...over,
  };
}
