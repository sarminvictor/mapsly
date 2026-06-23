// Phase 6/4.13 · Lighthouse opportunity mining → pitchable wins + rollups.

import { describe, expect, test } from "vitest";
import { extractOpportunities } from "../extract-opportunities";

const lhr = {
  configSettings: { formFactor: "mobile" },
  audits: {
    "render-blocking-resources": {
      score: 0.3,
      scoreDisplayMode: "numeric",
      displayValue: "Save 1.2 s",
      metricSavings: { LCP: 1200, FCP: 400 },
      details: { items: [{}, {}], overallSavingsBytes: 50000 },
    },
    "color-contrast": {
      score: 0,
      scoreDisplayMode: "binary",
      details: { items: [{}, {}, {}, {}, {}, {}] }, // 6 nodes → critical
    },
    "image-alt": {
      score: 0,
      scoreDisplayMode: "binary",
      details: { items: [{}, {}] }, // 2 nodes → violation but not critical
    },
    "is-on-https": { score: 0, scoreDisplayMode: "binary" }, // not https → fixable security
    "no-vulnerable-libraries": { score: 0, scoreDisplayMode: "binary" }, // vulnerable
    "tap-targets": { score: 1, scoreDisplayMode: "binary" }, // passing → ignored
    "first-contentful-paint": { score: 0.4, scoreDisplayMode: "numeric" }, // not bucketed → ignored
  },
};

describe("extractOpportunities", () => {
  test("collects failing bucketed audits only", () => {
    const r = extractOpportunities(lhr);
    const keys = r.opportunities.map((o) => o.auditKey).sort();
    expect(keys).toEqual([
      "color-contrast",
      "image-alt",
      "is-on-https",
      "no-vulnerable-libraries",
      "render-blocking-resources",
    ]);
    // passing tap-targets + unbucketed FCP excluded
    expect(keys).not.toContain("tap-targets");
    expect(keys).not.toContain("first-contentful-paint");
  });

  test("computes rollups", () => {
    const r = extractOpportunities(lhr);
    expect(r.rollups.perfSavingsMs).toBe(1600); // 1200 + 400
    expect(r.rollups.a11yViolationCount).toBe(2); // contrast + image-alt
    expect(r.rollups.a11yCriticalCount).toBe(1); // contrast has 6 nodes
    expect(r.rollups.isOnHttps).toBe(false);
    expect(r.rollups.hasVulnerableLibrary).toBe(true);
    expect(r.rollups.formFactor).toBe("mobile");
  });

  test("empty report → no opportunities", () => {
    const r = extractOpportunities({ audits: {} });
    expect(r.opportunities).toHaveLength(0);
    expect(r.rollups.a11yViolationCount).toBe(0);
    expect(r.rollups.isOnHttps).toBeNull();
  });
});
