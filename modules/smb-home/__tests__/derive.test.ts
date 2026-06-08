/**
 * Unit tests · SMB overview quick-win derivation.
 *
 * Per `.claude/rules/testing.md` we cover the invariants Maria would notice
 * if they flipped — which section a fix comes from, the priority order, the
 * cap, and the voice-rule promise that no banned jargon leaks into copy.
 */

import { describe, expect, test } from "vitest";

import { type OverviewFixInput, deriveOverviewFixes } from "../derive";
import { MAX_FIXES } from "../types";

const base = (overrides: Partial<OverviewFixInput> = {}): OverviewFixInput => ({
  reputation: 8,
  visibility: 8,
  profile: 8,
  website: 8,
  advertising: 8,
  adsApplicable: true,
  unansweredReviewCount: 0,
  replyRate: 0.5,
  ...overrides,
});

describe("deriveOverviewFixes", () => {
  test("a healthy business has no quick wins", () => {
    expect(deriveOverviewFixes(base())).toEqual([]);
  });

  test("unanswered reviews lead and come from the reputation section", () => {
    const fixes = deriveOverviewFixes(base({ unansweredReviewCount: 8 }));
    expect(fixes[0]?.section).toBe("reputation");
    expect(fixes[0]?.rank).toBe(1);
    expect(fixes[0]?.action).toMatch(/reply to 8 unanswered reviews/i);
  });

  test("not advertising surfaces an advertising quick win", () => {
    const fixes = deriveOverviewFixes(base({ adsApplicable: false }));
    expect(fixes.some((f) => f.section === "advertising")).toBe(true);
  });

  test("a section that isn't 'strong' yet (below 7) gets a quick win", () => {
    // 6.6 website was silent under the old < 5 rule — now it advises.
    const fixes = deriveOverviewFixes(base({ website: 6.6 }));
    expect(fixes.some((f) => f.section === "website")).toBe(true);
  });

  test("a strong section (>= 7) gets no quick win", () => {
    const fixes = deriveOverviewFixes(base({ website: 7.2 }));
    expect(fixes.some((f) => f.section === "website")).toBe(false);
  });

  test("the reply fix outranks the ads fix", () => {
    const fixes = deriveOverviewFixes(
      base({ unansweredReviewCount: 3, adsApplicable: false }),
    );
    const rep = fixes.findIndex((f) => f.section === "reputation");
    const ads = fixes.findIndex((f) => f.section === "advertising");
    expect(rep).toBeGreaterThanOrEqual(0);
    expect(ads).toBeGreaterThan(rep);
  });

  test("reply impact scales with the reply-rate gap, not the raw count", () => {
    // Model-derived: lift = (1 − replyRate) × responsiveness_weight, weighted
    // into the master. A lower current reply rate ⇒ more headroom ⇒ bigger lift.
    const nearlyDone = deriveOverviewFixes(
      base({ unansweredReviewCount: 5, replyRate: 0.8 }),
    );
    const farBehind = deriveOverviewFixes(
      base({ unansweredReviewCount: 5, replyRate: 0.2 }),
    );
    const a = parseFloat(nearlyDone[0]?.impact.replace("+", "") ?? "0");
    const b = parseFloat(farBehind[0]?.impact.replace("+", "") ?? "0");
    expect(b).toBeGreaterThan(a);
  });

  test("reply lift never reaches the old hard-coded +0.9 ceiling", () => {
    // Even from a 0% reply rate, the reputation pillar's responsiveness term
    // caps at 0.25 × 10 = 2.5 pillar points; through the master weight (0.30)
    // and renormalisation (weightTotal ≤ 1) the absolute ceiling is
    // 2.5 × 0.30 / 1.0 = 0.75 — strictly below the old fabricated "+0.9".
    const maxed = deriveOverviewFixes(
      base({ reputation: 0, unansweredReviewCount: 200, replyRate: 0 }),
    );
    const lift = parseFloat(
      maxed.find((f) => f.section === "reputation")?.impact.replace("+", "") ??
        "0",
    );
    expect(lift).toBeLessThan(0.9);
  });

  test("never exceeds MAX_FIXES and ranks are 1..N", () => {
    const fixes = deriveOverviewFixes(
      base({
        unansweredReviewCount: 5,
        visibility: 2,
        profile: 3,
        website: 2,
        advertising: 0,
        adsApplicable: false,
      }),
    );
    expect(fixes.length).toBeLessThanOrEqual(MAX_FIXES);
    fixes.forEach((f, i) => expect(f.rank).toBe(i + 1));
  });

  test("null section scores never trigger a fix (only measured gaps do)", () => {
    const fixes = deriveOverviewFixes(
      base({
        reputation: null,
        visibility: null,
        profile: null,
        website: null,
        advertising: null,
        adsApplicable: null,
        unansweredReviewCount: 0,
      }),
    );
    expect(fixes).toEqual([]);
  });

  test("action copy is Maria voice — no banned jargon", () => {
    const fixes = deriveOverviewFixes(
      base({
        unansweredReviewCount: 5,
        visibility: 2,
        profile: 3,
        website: 2,
        advertising: 0,
        adsApplicable: false,
      }),
    );
    const haystack = fixes
      .map((f) => `${f.action} ${f.meta ?? ""} ${f.impactSub}`)
      .join(" ");
    expect(haystack).not.toMatch(
      /\b(LCP|INP|CLS|CTR|MSI|3-pack|schema|NAP|GBP|organic rank)\b/i,
    );
  });
});
