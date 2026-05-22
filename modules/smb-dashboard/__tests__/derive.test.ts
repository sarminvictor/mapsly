/**
 * Unit tests for the SMB dashboard derivation helpers.
 *
 * Per `.claude/rules/testing.md` we cover the invariants Maria would
 * notice if they flipped — alert priority, fix selection, and the
 * voice-rule promise that no banned-jargon term leaks into copy.
 */

import { describe, expect, test } from "vitest";

import { type DeriveInput, deriveAlerts, deriveTopFixes } from "../derive";
import { MAX_ALERTS } from "../types";

const baseInput = (overrides: Partial<DeriveInput> = {}): DeriveInput => ({
  unansweredReviewCount: 0,
  reviewsLast30d: 0,
  replyRate: 1,
  rating: 4.6,
  reviewCount: 200,
  profileCompletenessScore: 0.9,
  brandPresenceScore: 0.9,
  brandHijackStatus: "clean",
  msiRank: 5,
  msiTotal: 40,
  ...overrides,
});

describe("deriveAlerts", () => {
  test("returns no alerts when nothing's wrong", () => {
    expect(deriveAlerts(baseInput())).toEqual([]);
  });

  test("brand-hijack hit takes priority 1", () => {
    const alerts = deriveAlerts(
      baseInput({ brandHijackStatus: "hit", unansweredReviewCount: 12 }),
    );
    expect(alerts[0]?.id).toBe("brand-hijack-hit");
    expect(alerts[0]?.tone).toBe("bad");
  });

  test("unanswered reviews fall in the top 2 with 'warn' tone for low count", () => {
    const alerts = deriveAlerts(baseInput({ unansweredReviewCount: 1 }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.tone).toBe("warn");
    expect(alerts[0]?.body).toMatch(/1 review is waiting/);
  });

  test("≥ 5 unanswered upgrades tone to 'bad'", () => {
    const alerts = deriveAlerts(baseInput({ unansweredReviewCount: 8 }));
    expect(alerts[0]?.tone).toBe("bad");
    expect(alerts[0]?.body).toMatch(/8 reviews are waiting/);
  });

  test("low reply rate only triggers above review-count threshold", () => {
    const lowVolume = deriveAlerts(
      baseInput({ replyRate: 0.1, reviewCount: 3 }),
    );
    expect(lowVolume.find((a) => a.id === "low-reply-rate")).toBeUndefined();

    const highVolume = deriveAlerts(
      baseInput({ replyRate: 0.1, reviewCount: 30 }),
    );
    expect(highVolume.find((a) => a.id === "low-reply-rate")).toBeDefined();
  });

  test("caps at MAX_ALERTS even when many rules fire", () => {
    const alerts = deriveAlerts(
      baseInput({
        brandHijackStatus: "hit",
        unansweredReviewCount: 12,
        replyRate: 0.1,
        rating: 3.4,
        profileCompletenessScore: 0.4,
        reviewCount: 15,
      }),
    );
    expect(alerts.length).toBeLessThanOrEqual(MAX_ALERTS);
  });

  test("body copy is Maria voice — no banned jargon", () => {
    const alerts = deriveAlerts(
      baseInput({
        brandHijackStatus: "hit",
        unansweredReviewCount: 6,
        replyRate: 0.1,
        rating: 3.7,
        profileCompletenessScore: 0.3,
        reviewCount: 50,
      }),
    );
    const haystack = alerts.map((a) => `${a.body} ${a.meta ?? ""}`).join(" ");
    expect(haystack).not.toMatch(
      /\b(LCP|INP|CLS|CTR|MSI|3-pack|local 3-pack|schema|NAP|GBP|organic rank)\b/i,
    );
  });
});

describe("deriveTopFixes", () => {
  test("returns at most 3 fixes ranked 1..3", () => {
    const fixes = deriveTopFixes(
      baseInput({
        unansweredReviewCount: 8,
        profileCompletenessScore: 0.5,
        rating: 4.2,
        brandPresenceScore: 0.3,
      }),
    );
    expect(fixes.length).toBeLessThanOrEqual(3);
    fixes.forEach((f, i) => expect(f.rank).toBe(i + 1));
  });

  test("returns empty when Maria's data is perfect", () => {
    expect(
      deriveTopFixes(
        baseInput({
          unansweredReviewCount: 0,
          profileCompletenessScore: 0.95,
          rating: 4.9,
          brandPresenceScore: 0.95,
        }),
      ),
    ).toEqual([]);
  });

  test("unanswered-reviews fix scales impact with count", () => {
    const small = deriveTopFixes(baseInput({ unansweredReviewCount: 1 }));
    const big = deriveTopFixes(baseInput({ unansweredReviewCount: 20 }));
    const smallLift = parseFloat(small[0]?.impact.replace("+", "") ?? "0");
    const bigLift = parseFloat(big[0]?.impact.replace("+", "") ?? "0");
    expect(bigLift).toBeGreaterThan(smallLift);
  });

  test("brand-hijack pre-empts other fixes (priority 0)", () => {
    const fixes = deriveTopFixes(
      baseInput({
        brandHijackStatus: "hit",
        unansweredReviewCount: 8,
        profileCompletenessScore: 0.4,
      }),
    );
    expect(fixes[0]?.action.toLowerCase()).toMatch(/your name/);
    expect(fixes[0]?.tone).toBe("warn");
  });

  test("action copy is Maria voice — no banned jargon", () => {
    const fixes = deriveTopFixes(
      baseInput({
        unansweredReviewCount: 5,
        profileCompletenessScore: 0.5,
        rating: 4.2,
        brandPresenceScore: 0.3,
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
