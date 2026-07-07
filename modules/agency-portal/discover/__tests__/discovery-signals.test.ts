// P3 · the discover-flow signal-alignment round-trip + the workbench match
// source switch. Covers the PURE pieces that thread the goal's signals through
// to a REAL match%:
//   1. buildDiscoverySignals  · goal filters → persisted JSON (active only).
//   2. parseDiscoverySignals  · untrusted JSON → typed payload (malformed → null).
//   3. toActiveSignals        · persisted key → ActiveSignal via SIG_META.
//   4. resolveLeadMatch       · eval result wins; null-only / none → heuristic.
//   5. end-to-end             · persisted signals → resolveMatches → match%, a
//      null (not-computable) signal is EXCLUDED (never a fake match); no
//      signalsJson → deriveMatchPct fallback.
//
// No DB: hydration is exercised by HydratedBusiness literals (the evaluator is
// pure). Mirrors signal-eval.test.ts's factory style.

import { describe, expect, test } from "vitest";

import {
  buildDiscoverySignals,
  parseDiscoverySignals,
  goalMetaFromJson,
  toActiveSignals,
  activeSignalsFromJson,
  allLibraryActiveSignals,
  allLibrarySignals,
  type PersistedSignal,
} from "../discovery-signals";
import { deriveMatchPct, resolveLeadMatch } from "../leads-workbench";
import { resolveMatches, type HydratedBusiness } from "../signal-eval";
import { SIG_META } from "../goal-templates";

const NOW = new Date("2026-06-30T12:00:00Z");

// ── HydratedBusiness factory (every slot empty/null; override per test) ───────
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
    ads: {
      activeCount: 0,
      hasVideo: false,
      formats: [],
      newestAgeDays: null,
      landingHostCount: 0,
      landingIsHomepageOnly: null,
      meta: {
        scanned: false,
        activeCount: 0,
        hasVideo: false,
        formats: [],
        newestAgeDays: null,
      },
      google: {
        scanned: false,
        activeCount: 0,
        hasVideo: false,
        formats: [],
        newestAgeDays: null,
      },
    },
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

function lh(
  over: Partial<NonNullable<HydratedBusiness["lighthouse"]>> = {},
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

// ── 1 · buildDiscoverySignals ────────────────────────────────────────────────
describe("buildDiscoverySignals", () => {
  test("keeps only active filters and carries tune/conds/match where set", () => {
    const out = buildDiscoverySignals([
      {
        key: "slow_site",
        on: true,
        tune: { kind: "strictness", level: "strict" },
      },
      { key: "has_website", on: false }, // dropped (off)
      {
        key: "flying_blind",
        on: true,
        match: "any",
        conds: { "0": true, "1": false },
      },
      { key: "operating_business", on: true }, // no tune → bare entry
    ]);
    expect(out.signals).toEqual([
      { key: "slow_site", tune: { kind: "strictness", level: "strict" } },
      { key: "flying_blind", match: "any", conds: { "0": true, "1": false } },
      { key: "operating_business" },
    ]);
  });

  test("no active filters → empty signals", () => {
    expect(buildDiscoverySignals([{ key: "x", on: false }]).signals).toEqual(
      [],
    );
  });
});

// ── 2 · parseDiscoverySignals (untrusted JSON) ───────────────────────────────
describe("parseDiscoverySignals", () => {
  test("round-trips a built payload", () => {
    const built = buildDiscoverySignals([
      {
        key: "slow_site",
        on: true,
        tune: { kind: "strictness", level: "loose" },
      },
    ]);
    const parsed = parseDiscoverySignals(built);
    expect(parsed?.signals).toEqual(built.signals);
  });

  test("null / non-object / missing-array → null", () => {
    expect(parseDiscoverySignals(null)).toBeNull();
    expect(parseDiscoverySignals("nope")).toBeNull();
    expect(parseDiscoverySignals({})).toBeNull();
    expect(parseDiscoverySignals({ signals: "x" })).toBeNull();
  });

  test("drops malformed entries + invalid tune/match, keeps valid keys", () => {
    const parsed = parseDiscoverySignals({
      signals: [
        { key: "slow_site", tune: { kind: "bogus" }, match: "sometimes" },
        { key: "" }, // empty key dropped
        { notKey: 1 }, // no key dropped
        { key: "has_website", match: "all", conds: { "0": "yes" } }, // bad conds dropped
      ],
    });
    expect(parsed?.signals).toEqual([
      { key: "slow_site" }, // bogus tune + bad match stripped
      { key: "has_website", match: "all" }, // bad conds stripped
    ]);
  });
});

// ── 3 · toActiveSignals (key → ActiveSignal via SIG_META) ────────────────────
describe("toActiveSignals", () => {
  test("merges SIG_META registryKey/comparator/value with persisted tune", () => {
    const persisted: PersistedSignal[] = [
      { key: "slow_site", tune: { kind: "strictness", level: "strict" } },
    ];
    const [sig] = toActiveSignals(persisted);
    const meta = SIG_META.slow_site;
    expect(sig.key).toBe("slow_site");
    expect(sig.registryKey).toBe(meta.registryKey);
    expect(sig.comparator).toBe(meta.comparator);
    expect(sig.value).toBe(meta.value);
    expect(sig.tune).toEqual({ kind: "strictness", level: "strict" });
  });

  test("drops a persisted key with no SIG_META entry", () => {
    expect(toActiveSignals([{ key: "does_not_exist" }])).toEqual([]);
  });
});

// ── 3b · the full signal library (#2 · filter by all signals) ────────────────
describe("allLibraryActiveSignals / allLibrarySignals", () => {
  test("excludes roadmap signals, includes ready/deriv ones (all evaluable)", () => {
    const keys = new Set(allLibraryActiveSignals().map((s) => s.key));
    // Every included key is non-roadmap; every non-roadmap SIG_META key is included.
    for (const [key, meta] of Object.entries(SIG_META)) {
      expect(keys.has(key)).toBe(meta.status !== "roadmap");
    }
    // A known roadmap signal is out; a known ready signal is in.
    expect(keys.has("slow_site")).toBe(true); // status: ready
  });

  test("carries SIG_META default comparator/value + registryKey, and no tune", () => {
    const byKey = new Map(allLibraryActiveSignals().map((s) => [s.key, s]));
    const sig = byKey.get("slow_site");
    const meta = SIG_META.slow_site;
    expect(sig?.comparator).toBe(meta.comparator);
    expect(sig?.value).toBe(meta.value);
    expect(sig?.registryKey).toBe(meta.registryKey);
    expect(sig?.tune).toBeUndefined();
  });

  test("the {key,title} option list matches the ActiveSignal set 1:1", () => {
    const options = allLibrarySignals();
    const active = allLibraryActiveSignals();
    expect(options.map((o) => o.key).sort()).toEqual(
      active.map((s) => s.key).sort(),
    );
    // Titles come straight from SIG_META.
    for (const o of options) expect(o.title).toBe(SIG_META[o.key].title);
  });
});

// ── 4 · resolveLeadMatch (the workbench match source switch) ──────────────────
describe("resolveLeadMatch", () => {
  test("uses the eval result when at least one signal is applicable", () => {
    const r = resolveLeadMatch(
      {
        perSignal: { a: true, b: false },
        matchedCount: 1,
        applicableCount: 2,
        matchPct: 0.5,
      },
      null,
      3, // pain count ignored when signals apply
    );
    expect(r.match).toBe(50);
    expect(r.matchFromSignals).toBe(true);
    expect(r.matchDerived).toBe(false);
    expect(r.perSignal).toEqual({ a: true, b: false });
  });

  test("eval with ZERO applicable signals (all null) → heuristic fallback, verdicts kept", () => {
    const r = resolveLeadMatch(
      {
        perSignal: { a: null, b: null },
        matchedCount: 0,
        applicableCount: 0,
        matchPct: 0,
      },
      null,
      2,
    );
    const heur = deriveMatchPct(null, 2);
    expect(r.matchFromSignals).toBe(false);
    expect(r.match).toBe(heur.match); // 75 for 2 pains
    expect(r.perSignal).toEqual({ a: null, b: null }); // still surfaced (honest "enrich to unlock")
  });

  test("no eval result (null) → heuristic, respecting a stored score", () => {
    const r = resolveLeadMatch(null, 0.9, 0);
    expect(r.matchFromSignals).toBe(false);
    expect(r.match).toBe(90); // stored 0.9 → 90
    expect(r.perSignal).toEqual({});
  });
});

// ── 5 · END-TO-END · persisted signals → real match% (null excluded) ─────────
describe("end-to-end · workbench match from signalsJson", () => {
  // A discovery whose research chose two computable signals + one not-yet one.
  const signalsJson = buildDiscoverySignals([
    { key: "slow_site", on: true }, // lighthouse_performance < 50
    { key: "has_website", on: true }, // computable from the listing
    { key: "reviews_trending", on: true }, // NO registryKey → null (not computable)
  ]);

  test("match% comes from resolveMatches; a null signal is excluded (not a fake match)", () => {
    const activeSignals = activeSignalsFromJson(signalsJson);
    // slow_site matches (perf 30 < 50); has_website matches; reviews_trending null.
    const b = biz({
      lighthouse: lh({ performance: 30 }),
      business: { website: "https://x.com" },
    });
    const result = resolveMatches(activeSignals, b, NOW);
    // reviews_trending is excluded from the denominator (null, not computable).
    expect(result.applicableCount).toBe(2);
    expect(result.matchedCount).toBe(2);
    expect(result.perSignal.reviews_trending).toBeNull();

    const m = resolveLeadMatch(result, null, /* pains */ 0);
    expect(m.matchFromSignals).toBe(true);
    expect(m.match).toBe(100); // 2/2, NOT diluted by the null signal
  });

  test("a partial cohort yields a fractional match% from real eval", () => {
    const activeSignals = activeSignalsFromJson(signalsJson);
    // slow_site does NOT match (perf 95); has_website matches; trending null.
    const b = biz({
      lighthouse: lh({ performance: 95 }),
      business: { website: "https://x.com" },
    });
    const result = resolveMatches(activeSignals, b, NOW);
    const m = resolveLeadMatch(result, null, 4);
    expect(m.matchFromSignals).toBe(true);
    expect(m.match).toBe(50); // 1 of 2 applicable — heuristic (would be 92) NOT used
  });

  test("no signalsJson (older discovery) → empty ActiveSignal[] → deriveMatchPct fallback", () => {
    const activeSignals = activeSignalsFromJson(null);
    expect(activeSignals).toEqual([]);
    // The page passes evalResult=null when there are no signals → heuristic.
    const m = resolveLeadMatch(null, null, /* pains */ 3);
    const heur = deriveMatchPct(null, 3);
    expect(m.matchFromSignals).toBe(false);
    expect(m.match).toBe(heur.match); // 85 for 3 pains
  });
});

describe("goalName / goalBase round-trip (research resume)", () => {
  test("buildDiscoverySignals persists goal identity when provided", () => {
    const out = buildDiscoverySignals([{ key: "has_website", on: true }], {
      goalName: "Website redesign",
      goalBase: "website",
    });
    expect(out.goalName).toBe("Website redesign");
    expect(out.goalBase).toBe("website");
    expect(out.signals).toEqual([{ key: "has_website" }]);
  });

  test("omits goal identity when not provided (back-compat)", () => {
    const out = buildDiscoverySignals([{ key: "has_website", on: true }]);
    expect(out.goalName).toBeUndefined();
    expect(out.goalBase).toBeUndefined();
  });

  test("parseDiscoverySignals reads goal identity back", () => {
    const parsed = parseDiscoverySignals({
      signals: [{ key: "has_website" }],
      goalName: "Sell websites",
      goalBase: "website",
    });
    expect(parsed?.goalName).toBe("Sell websites");
    expect(parsed?.goalBase).toBe("website");
  });

  test("goalMetaFromJson returns nulls for older discoveries (no identity)", () => {
    expect(goalMetaFromJson({ signals: [{ key: "has_website" }] })).toEqual({
      goalName: null,
      goalBase: null,
    });
    expect(goalMetaFromJson(null)).toEqual({ goalName: null, goalBase: null });
  });
});
