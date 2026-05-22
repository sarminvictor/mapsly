/**
 * Unit tests for the smb-website pure derive helpers.
 *
 * Per `.claude/rules/testing.md` we cover the invariants Maria would
 * feel — verdict thresholds + the no-banned-jargon promise.
 */

import { describe, expect, test } from "vitest";

import {
  deriveWebsiteFixes,
  verdictForCls,
  verdictForInp,
  verdictForLcp,
  verdictForPerf,
} from "../types";

describe("verdictForPerf", () => {
  test("null → neutral 'check soon'", () => {
    expect(verdictForPerf(null)).toEqual({
      verdict: "We'll check soon",
      tone: "neutral",
    });
  });
  test("≥ 90 → Quick / good", () => {
    expect(verdictForPerf(95)).toEqual({ verdict: "Quick", tone: "good" });
  });
  test("70–89 → OK / neutral", () => {
    expect(verdictForPerf(80)).toEqual({ verdict: "OK", tone: "neutral" });
  });
  test("50–69 → A bit slow / warn", () => {
    expect(verdictForPerf(60)).toEqual({
      verdict: "A bit slow",
      tone: "warn",
    });
  });
  test("< 50 → Slow / bad", () => {
    expect(verdictForPerf(20)).toEqual({ verdict: "Slow", tone: "bad" });
  });
});

describe("verdictForLcp", () => {
  test("≤ 2.5s → good", () => {
    expect(verdictForLcp(1.8).tone).toBe("good");
  });
  test("2.5-4.0s → warn", () => {
    expect(verdictForLcp(3.2).tone).toBe("warn");
  });
  test("> 4.0s → bad", () => {
    expect(verdictForLcp(5.5).tone).toBe("bad");
  });
});

describe("verdictForInp", () => {
  test("≤ 200ms → good", () => {
    expect(verdictForInp(150).tone).toBe("good");
  });
  test("200-500ms → warn", () => {
    expect(verdictForInp(350).tone).toBe("warn");
  });
  test("> 500ms → bad", () => {
    expect(verdictForInp(800).tone).toBe("bad");
  });
});

describe("verdictForCls", () => {
  test("≤ 0.1 → good", () => {
    expect(verdictForCls(0.05).tone).toBe("good");
  });
  test("0.1-0.25 → warn", () => {
    expect(verdictForCls(0.18).tone).toBe("warn");
  });
  test("> 0.25 → bad", () => {
    expect(verdictForCls(0.4).tone).toBe("bad");
  });
});

describe("deriveWebsiteFixes", () => {
  const noFixesInput = {
    performance: 95,
    lcpSeconds: 1.5,
    hasLocalBusinessSchema: true,
    hasFaqSchema: true,
    hasBookingCtaAboveFold: true,
    hasPhoneAboveFold: true,
    napConsistent: true,
  };

  test("returns empty when everything is good", () => {
    expect(deriveWebsiteFixes(noFixesInput)).toEqual([]);
  });

  test("caps at 5 fixes even when more rules fire", () => {
    const fixes = deriveWebsiteFixes({
      performance: 30,
      lcpSeconds: 5.5,
      hasLocalBusinessSchema: false,
      hasFaqSchema: false,
      hasBookingCtaAboveFold: false,
      hasPhoneAboveFold: false,
      napConsistent: false,
    });
    expect(fixes.length).toBeLessThanOrEqual(5);
    fixes.forEach((f, i) => expect(f.rank).toBe(i + 1));
  });

  test("LCP > 2.5s pre-empts the perf fallback", () => {
    const fixes = deriveWebsiteFixes({
      ...noFixesInput,
      lcpSeconds: 4.5,
      performance: 40,
    });
    expect(fixes[0]?.action).toMatch(/first thing/i);
  });

  test("body copy contains NO banned-jargon words", () => {
    const fixes = deriveWebsiteFixes({
      performance: 30,
      lcpSeconds: 5.5,
      hasLocalBusinessSchema: false,
      hasFaqSchema: false,
      hasBookingCtaAboveFold: false,
      hasPhoneAboveFold: false,
      napConsistent: false,
    });
    const haystack = fixes
      .map((f) => `${f.action} ${f.why} ${f.effort}`)
      .join(" ");
    expect(haystack).not.toMatch(
      /\b(LCP|INP|CLS|CTR|MSI|3-pack|schema\.org|NAP\b|GBP|organic rank|SERP)\b/i,
    );
  });
});
