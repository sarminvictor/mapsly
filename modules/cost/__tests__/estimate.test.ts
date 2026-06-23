// Golden tests for the pre-flight cost estimator (Phase 0). These lock the
// price-list math + the cost-gate boundaries so any pricing change is a
// deliberate, visible diff.

import { describe, expect, test } from "vitest";
import {
  estimateRun,
  estimateDiscovery,
  gateFor,
  usdToCredits,
} from "../estimate";
import { CREDIT_USD, ENRICHMENT_PRICES } from "../pricing";

describe("price list (golden)", () => {
  test("unit costs are the agreed values", () => {
    expect(ENRICHMENT_PRICES.reviews.usdPerUnit).toBeCloseTo(0.015, 6);
    expect(ENRICHMENT_PRICES.lighthouse.usdPerUnit).toBeCloseTo(0.0025, 6);
    expect(ENRICHMENT_PRICES.contacts.usdPerUnit).toBeCloseTo(0.008, 6);
    expect(ENRICHMENT_PRICES.serp.usdPerUnit).toBeCloseTo(0.16, 6);
    expect(ENRICHMENT_PRICES.google_ads.usdPerUnit).toBeCloseTo(0.052, 6);
    expect(ENRICHMENT_PRICES.meta_ads.usdPerUnit).toBeCloseTo(0.05, 6);
    expect(CREDIT_USD).toBe(0.05);
  });
});

describe("gateFor", () => {
  test("auto below $2, confirm at $2..$5, approval above $5", () => {
    expect(gateFor(0)).toBe("auto");
    expect(gateFor(1.99)).toBe("auto");
    expect(gateFor(2)).toBe("confirm");
    expect(gateFor(5)).toBe("confirm");
    expect(gateFor(5.01)).toBe("approval");
  });
});

describe("usdToCredits", () => {
  test("rounds up; $0 → 0 credits", () => {
    expect(usdToCredits(0)).toBe(0);
    expect(usdToCredits(0.04)).toBe(1);
    expect(usdToCredits(0.05)).toBe(1);
    expect(usdToCredits(0.06)).toBe(2);
    expect(usdToCredits(7.5)).toBe(150);
  });
});

describe("estimateRun", () => {
  test("empty → all zeros, auto gate, exact", () => {
    const r = estimateRun({ lines: [] });
    expect(r.netUsd).toBe(0);
    expect(r.netCredits).toBe(0);
    expect(r.gate).toBe("auto");
    expect(r.confidence).toBe("exact");
  });

  test("contacts ×100 (variable) → bounded, auto gate", () => {
    const r = estimateRun({ lines: [{ enrichment: "contacts", total: 100 }] });
    expect(r.grossUsd).toBeCloseTo(0.8, 4);
    expect(r.freshHitUsd).toBe(0);
    expect(r.netUsd).toBeCloseTo(0.8, 4);
    expect(r.upperBoundUsd).toBeCloseTo(2.7, 4); // 100 × 0.008 × 3.375
    expect(r.netCredits).toBe(16); // ceil(0.8 / 0.05)
    expect(r.confidence).toBe("bounded");
    expect(r.gate).toBe("auto");
  });

  test("lighthouse ×100 with 20 fresh → fresh saves $0.05, exact", () => {
    const r = estimateRun({
      lines: [{ enrichment: "lighthouse", total: 100, fresh: 20 }],
    });
    const line = r.lines[0];
    expect(line.billable).toBe(80);
    expect(line.grossUsd).toBeCloseTo(0.25, 4);
    expect(line.freshHitUsd).toBeCloseTo(0.05, 4);
    expect(r.netUsd).toBeCloseTo(0.2, 4);
    expect(r.upperBoundUsd).toBeCloseTo(0.2, 4); // fixed cost
    expect(r.netCredits).toBe(4);
    expect(r.confidence).toBe("exact");
    expect(r.gate).toBe("auto");
  });

  test("reviews ×500 → $7.50, approval gate, bounded", () => {
    const r = estimateRun({ lines: [{ enrichment: "reviews", total: 500 }] });
    expect(r.netUsd).toBeCloseTo(7.5, 4);
    expect(r.netCredits).toBe(150);
    expect(r.gate).toBe("approval");
    expect(r.confidence).toBe("bounded");
  });

  test("combined run → confirm gate, deduped freshness", () => {
    const r = estimateRun({
      lines: [
        { enrichment: "lighthouse", total: 100, fresh: 20 }, // net 0.20
        { enrichment: "serp", total: 9 }, // net 1.44
        { enrichment: "reviews", total: 50, fresh: 10 }, // net 0.60
      ],
    });
    expect(r.netUsd).toBeCloseTo(2.24, 4);
    expect(r.gate).toBe("confirm");
    expect(r.confidence).toBe("bounded"); // reviews is variable
    expect(r.netCredits).toBe(45); // ceil(2.24/0.05)
  });

  test("all fresh → net $0 but freshHit shows the saving", () => {
    const r = estimateRun({
      lines: [{ enrichment: "contacts", total: 50, fresh: 50 }],
    });
    expect(r.netUsd).toBe(0);
    expect(r.freshHitUsd).toBeCloseTo(0.4, 4);
    expect(r.netCredits).toBe(0);
    expect(r.gate).toBe("auto");
    expect(r.confidence).toBe("exact"); // nothing billable
  });

  test("fresh is clamped to total", () => {
    const r = estimateRun({
      lines: [{ enrichment: "lighthouse", total: 10, fresh: 999 }],
    });
    expect(r.lines[0].fresh).toBe(10);
    expect(r.netUsd).toBe(0);
  });

  test("rejects bad counts + unknown enrichment", () => {
    expect(() =>
      estimateRun({ lines: [{ enrichment: "reviews", total: -1 }] }),
    ).toThrow();
    expect(() =>
      estimateRun({ lines: [{ enrichment: "reviews", total: 1.5 }] }),
    ).toThrow();
    expect(() =>
      // @ts-expect-error unknown enrichment key
      estimateRun({ lines: [{ enrichment: "nope", total: 1 }] }),
    ).toThrow();
  });
});

describe("estimateDiscovery", () => {
  test("fresh cells serve from DB ($0); fetch cells billed by listings", () => {
    const r = estimateDiscovery([
      { fresh: true, expectedListings: 138 }, // 0.0514, saved
      { fresh: false, expectedListings: 100 }, // 0.04, billed
    ]);
    expect(r.freshCells).toBe(1);
    expect(r.fetchCells).toBe(1);
    expect(r.netUsd).toBeCloseTo(0.04, 4);
    expect(r.freshHitUsd).toBeCloseTo(0.0514, 4);
    expect(r.netCredits).toBe(1);
    expect(r.gate).toBe("auto");
  });
});
