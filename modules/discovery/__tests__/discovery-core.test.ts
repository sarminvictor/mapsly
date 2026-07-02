// Phase 2 · open-status extraction + the 6-month freshness gate.

import { describe, expect, test } from "vitest";
import {
  mapOpenStatus,
  extractOpenStatus,
  isExcludedFromRawList,
} from "../open-status";
import {
  decideDiscoveryPlan,
  effectiveLastDiscoveredAt,
} from "../freshness-decision";

const NOW = new Date("2026-06-22T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("open status", () => {
  test("maps DfS current_status", () => {
    expect(mapOpenStatus("closed_forever")).toBe("CLOSED_FOREVER");
    expect(mapOpenStatus("permanently_closed")).toBe("CLOSED_FOREVER");
    expect(mapOpenStatus("temporarily_closed")).toBe("TEMPORARILY_CLOSED");
    expect(mapOpenStatus("open")).toBe("OPEN");
    expect(mapOpenStatus("close")).toBe("OPEN"); // closed-right-now still operating
    expect(mapOpenStatus(null)).toBe("UNKNOWN");
    expect(mapOpenStatus("garbage")).toBe("UNKNOWN");
  });

  test("extracts from a raw DfS row", () => {
    expect(
      extractOpenStatus({
        work_time: { work_hours: { current_status: "temporarily_closed" } },
      }),
    ).toBe("TEMPORARILY_CLOSED");
    expect(extractOpenStatus({})).toBe("UNKNOWN");
    expect(extractOpenStatus(null)).toBe("UNKNOWN");
  });

  test("only permanently-closed is excluded from the raw list by default", () => {
    expect(isExcludedFromRawList({ openStatus: "CLOSED_FOREVER" })).toBe(true);
    expect(isExcludedFromRawList({ openStatus: "TEMPORARILY_CLOSED" })).toBe(
      false,
    );
    expect(isExcludedFromRawList({ openStatus: "OPEN" })).toBe(false);
  });
});

describe("decideDiscoveryPlan — 6-month gate", () => {
  test("fresh cells serve from DB; stale/never cells re-fetch — discovery is always free", () => {
    const plan = decideDiscoveryPlan(
      [
        {
          cellKey: "medical_spa|miami|US",
          lastDiscoveredAt: daysAgo(40),
          expectedListings: 138,
        }, // fresh
        {
          cellKey: "day_spa|miami|US",
          lastDiscoveredAt: daysAgo(200),
          expectedListings: 100,
        }, // stale
        {
          cellKey: "med_spa|tampa|US",
          lastDiscoveredAt: null,
          expectedListings: 60,
        }, // never
      ],
      NOW,
    );
    expect(plan.freshCount).toBe(1);
    expect(plan.refetchCount).toBe(2);
    expect(plan.cells[0].outcome).toBe("SERVED_FROM_DB");
    expect(plan.cells[1].outcome).toBe("REFETCH");
    expect(plan.cells[2].outcome).toBe("REFETCH");
    // Discovery (the raw market list) is ALWAYS free to the agency — the
    // fresh-vs-refetch GATE still runs (it decides whether WE need to re-hit
    // DfS), but it never charges credits either way.
    expect(plan.estimate.fetchCells).toBe(2);
    expect(plan.estimate.freshCells).toBe(1);
    expect(plan.estimate.netUsd).toBe(0);
    expect(plan.estimate.freshHitUsd).toBe(0);
    expect(plan.estimate.netCredits).toBe(0);
  });

  test("all-fresh discovery is free", () => {
    const plan = decideDiscoveryPlan(
      [
        {
          cellKey: "x|miami|US",
          lastDiscoveredAt: daysAgo(10),
          expectedListings: 200,
        },
      ],
      NOW,
    );
    expect(plan.estimate.netUsd).toBe(0);
    expect(plan.refetchCount).toBe(0);
  });
});

describe("effectiveLastDiscoveredAt — stale-anchor guard", () => {
  const anchor = daysAgo(10); // well inside the freshness window

  test("keeps a fresh anchor when the cell has businesses", () => {
    expect(effectiveLastDiscoveredAt(anchor, 2374)).toBe(anchor);
    expect(effectiveLastDiscoveredAt(anchor, 1)).toBe(anchor);
  });

  test("nulls a fresh anchor with zero businesses (orphaned → refetch)", () => {
    // The exact Toronto-dental bug: anchor says discovered, DB has 0 rows.
    expect(effectiveLastDiscoveredAt(anchor, 0)).toBeNull();
  });

  test("a null anchor stays null regardless of count", () => {
    expect(effectiveLastDiscoveredAt(null, 0)).toBeNull();
    expect(effectiveLastDiscoveredAt(null, 500)).toBeNull();
  });

  test("feeding it into decideDiscoveryPlan forces REFETCH on an empty fresh cell", () => {
    const plan = decideDiscoveryPlan(
      [
        {
          cellKey: "dental_clinic|toronto|CA",
          lastDiscoveredAt: effectiveLastDiscoveredAt(anchor, 0),
          expectedListings: 2374,
        },
      ],
      NOW,
    );
    expect(plan.cells[0].outcome).toBe("REFETCH");
    expect(plan.refetchCount).toBe(1);
  });
});
