// Unit tests for the Raw List "Enrich" estimator-line construction (Phase 9).
//
// `buildEnrichLines` is pure (no DB, no clock) so its line-input shape is
// asserted directly. We also feed its output through the real `estimateRun` to
// lock the per-business × count / per-cell × cellCount → cost contract.

import { describe, expect, test } from "vitest";

import { buildEnrichLines } from "../enrich-lines";
import { estimateRun } from "@/modules/cost/estimate";
import { ENRICHMENT_PRICES } from "@/modules/cost/pricing";

describe("buildEnrichLines", () => {
  test("per-business families use businessCount as total", () => {
    const lines = buildEnrichLines({
      enrichments: ["contacts", "services"],
      businessCount: 12,
      cellCount: 3,
    });
    expect(lines).toEqual([
      { enrichment: "contacts", total: 12, fresh: 0 },
      { enrichment: "services", total: 12, fresh: 0 },
    ]);
  });

  test("per-cell families use cellCount as total", () => {
    const lines = buildEnrichLines({
      enrichments: ["meta_ads", "serp"],
      businessCount: 50,
      cellCount: 4,
    });
    expect(lines).toEqual([
      { enrichment: "meta_ads", total: 4, fresh: 0 },
      { enrichment: "serp", total: 4, fresh: 0 },
    ]);
  });

  test("mixes business and cell scopes correctly", () => {
    const lines = buildEnrichLines({
      enrichments: ["contacts", "meta_ads"],
      businessCount: 20,
      cellCount: 2,
    });
    expect(lines).toEqual([
      { enrichment: "contacts", total: 20, fresh: 0 },
      { enrichment: "meta_ads", total: 2, fresh: 0 },
    ]);
  });

  test("threads fresh counts through (clamped non-negative)", () => {
    const lines = buildEnrichLines({
      enrichments: ["contacts"],
      businessCount: 10,
      cellCount: 0,
      freshByEnrichment: { contacts: 4 },
    });
    expect(lines[0]).toEqual({ enrichment: "contacts", total: 10, fresh: 4 });
  });

  test("output feeds estimateRun → cost matches usdPerUnit × billable", () => {
    const businessCount = 10;
    const lines = buildEnrichLines({
      enrichments: ["contacts"],
      businessCount,
      cellCount: 0,
    });
    const result = estimateRun({ lines });
    const expected = businessCount * ENRICHMENT_PRICES.contacts.usdPerUnit;
    // round4 in the estimator → compare with tolerance.
    expect(result.netUsd).toBeCloseTo(expected, 4);
    expect(result.lines[0]?.total).toBe(businessCount);
    expect(result.lines[0]?.billable).toBe(businessCount);
  });

  test("throws on an unknown enrichment key", () => {
    expect(() =>
      buildEnrichLines({
        // @ts-expect-error — deliberately invalid for the guard test.
        enrichments: ["nope"],
        businessCount: 1,
        cellCount: 1,
      }),
    ).toThrow(/unknown enrichment/);
  });
});

// ── P3 (2026-07-10) · per-family business-count overrides (dead-pair exclusion) ──
describe("buildEnrichLines · businessCountByEnrichment (P3)", () => {
  test("a per-family override changes only that line's total", () => {
    const lines = buildEnrichLines({
      enrichments: ["contacts", "reviews"],
      businessCount: 100,
      cellCount: 1,
      // e.g. 40 of 100 contacts pairs are permanently unavailable → 60 eligible.
      businessCountByEnrichment: { contacts: 60 },
    });
    const byKey = Object.fromEntries(lines.map((l) => [l.enrichment, l]));
    expect(byKey.contacts!.total).toBe(60); // excludes dead pairs
    expect(byKey.reviews!.total).toBe(100); // no dead reviews pairs → full scope
  });

  test("a cell line ignores the per-family business override", () => {
    const lines = buildEnrichLines({
      enrichments: ["meta_ads"],
      businessCount: 100,
      cellCount: 2,
      businessCountByEnrichment: { meta_ads: 7 },
    });
    expect(lines[0]!.total).toBe(2); // cellCount, not the override
  });
});
