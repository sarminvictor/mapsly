import { describe, expect, test } from "vitest";

import {
  countEntitled,
  countFreeUnits,
  type EntitlementSet,
} from "../entitlements";
import type { FreshTimestamps } from "../enrich-fresh";

const now = new Date("2026-07-08T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

function ent(
  perBusiness: Record<string, string[]> = {},
  perCell: Record<string, string[]> = {},
): EntitlementSet {
  return {
    perBusiness: new Map(
      Object.entries(perBusiness).map(([k, v]) => [k, new Set(v as never[])]),
    ),
    perCell: new Map(
      Object.entries(perCell).map(([k, v]) => [k, new Set(v as never[])]),
    ),
  };
}

describe("countEntitled · owned units per family", () => {
  test("counts a business as entitled only for families it owns", () => {
    const entitlements = ent({ b1: ["contacts", "reviews"], b2: ["contacts"] });
    const out = countEntitled({
      enrichments: ["contacts", "reviews"],
      businessIds: ["b1", "b2", "b3"],
      cellKeys: [],
      entitlements,
    });
    expect(out).toEqual({ contacts: 2, reviews: 1 });
  });

  test("per-cell families count owned cells", () => {
    const entitlements = ent({}, { "us|miami|spa": ["meta_ads"] });
    const out = countEntitled({
      enrichments: ["meta_ads", "serp"],
      businessIds: [],
      cellKeys: ["us|miami|spa", "us|miami|hair"],
      entitlements,
    });
    expect(out).toEqual({ meta_ads: 1, serp: 0 });
  });
});

describe("countFreeUnits · the ONLY free quadrant is owned ∧ fresh", () => {
  const ts = (
    perBusiness: Record<string, Record<string, Date>>,
  ): FreshTimestamps => ({
    perBusiness: new Map(
      Object.entries(perBusiness).map(([k, v]) => [k, v as never]),
    ),
    perCell: new Map(),
  });

  test("owned + fresh → free; owned + stale → NOT free (owner refresh charges)", () => {
    const entitlements = ent({ b1: ["contacts"], b2: ["contacts"] });
    const timestamps = ts({
      b1: { contacts: daysAgo(10) }, // fresh (contacts window 90d)
      b2: { contacts: daysAgo(200) }, // stale
    });
    const out = countFreeUnits({
      enrichments: ["contacts"],
      businessIds: ["b1", "b2"],
      cellKeys: [],
      entitlements,
      timestamps,
      now,
    });
    // only b1 (owned ∧ fresh) is free; b2 owned-but-stale is billable (refresh)
    expect(out).toEqual({ contacts: 1 });
  });

  test("NOT owned + fresh → NOT free (served-from-DB is billable, the margin path)", () => {
    const entitlements = ent({}); // owns nothing
    const timestamps = ts({ b1: { contacts: daysAgo(5) } }); // fresh copy exists
    const out = countFreeUnits({
      enrichments: ["contacts"],
      businessIds: ["b1"],
      cellKeys: [],
      entitlements,
      timestamps,
      now,
    });
    expect(out).toEqual({ contacts: 0 }); // billable — CHARGED_FROM_DB
  });

  test("owned but absent timestamp → not fresh → not free", () => {
    const entitlements = ent({ b1: ["reviews"] });
    const timestamps = ts({}); // no freshness recorded
    const out = countFreeUnits({
      enrichments: ["reviews"],
      businessIds: ["b1"],
      cellKeys: [],
      entitlements,
      timestamps,
      now,
    });
    expect(out).toEqual({ reviews: 0 });
  });
});
