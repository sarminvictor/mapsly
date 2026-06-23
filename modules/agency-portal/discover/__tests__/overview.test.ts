// Unit tests for the Research-overview pure builders (Phase 9 comprehension
// strip). buildCohorts + buildStandards are pure; getResearchOverview's DB read
// is covered by mocking the CellMetric lookup.

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: { cellMetric: { findFirst: vi.fn() } },
}));

import prisma from "@/lib/prisma";
import { buildCohorts, buildStandards, getResearchOverview } from "../overview";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

const SUMMARY = { total: 1204, reachable: 1061, phoneOnly: 220, hidden: 143 };

describe("buildCohorts", () => {
  test("three cohorts from the summary counts", () => {
    const c = buildCohorts(SUMMARY);
    expect(c).toHaveLength(3);
    expect(c[0]).toMatchObject({
      count: 1204,
      reachableCount: 1061,
      tone: "indigo",
    });
    expect(c[1]).toMatchObject({ count: 1061, tone: "green" });
    expect(c[2]).toMatchObject({ count: 143, tone: "red" });
  });
});

describe("buildStandards", () => {
  test("maps distribution blobs to rows + a reviewCount sparkline series", () => {
    const { standardRows, distributionSeries } = buildStandards({
      reviewCount: { p10: 10, p25: 40, p50: 120, p75: 240, p90: 410 },
      rating: { p10: 3.6, p25: 4.0, p50: 4.4, p75: 4.7, p90: 4.9 },
    });
    expect(standardRows.map((r) => r.label)).toEqual(["Reviews", "Rating"]);
    expect(standardRows[0]).toMatchObject({
      value: 120,
      p90: 410,
      percentile: 50,
    });
    expect(distributionSeries).toEqual([10, 40, 120, 240, 410]);
  });

  test("empty/missing distributions → no rows, no series", () => {
    expect(buildStandards(null)).toEqual({
      standardRows: [],
      distributionSeries: [],
    });
    expect(buildStandards({})).toEqual({
      standardRows: [],
      distributionSeries: [],
    });
  });
});

describe("getResearchOverview", () => {
  beforeEach(() => vi.clearAllMocks());

  test("derives cellLabel + standards from the metric", async () => {
    p.cellMetric.findFirst.mockResolvedValue({
      sampleSize: 42,
      distributions: {
        reviewCount: { p10: 5, p25: 20, p50: 80, p75: 160, p90: 300 },
      },
    });
    const o = await getResearchOverview({
      cellKeys: ["medical_spa|miami|US"],
      summary: SUMMARY,
    });
    expect(o.cellLabel).toBe("medical spa · miami");
    expect(o.sampleSize).toBe(42);
    expect(o.standardRows[0].label).toBe("Reviews");
    expect(o.distributionSeries).toEqual([5, 20, 80, 160, 300]);
    expect(o.cohorts).toHaveLength(3);
  });

  test("no metric → empty standards (limited-sample fallback)", async () => {
    p.cellMetric.findFirst.mockResolvedValue(null);
    const o = await getResearchOverview({
      cellKeys: ["hvac|austin|US"],
      summary: SUMMARY,
    });
    expect(o.cellLabel).toBe("hvac · austin");
    expect(o.standardRows).toEqual([]);
    expect(o.sampleSize).toBe(0);
  });

  test("no cells → safe defaults", async () => {
    const o = await getResearchOverview({ cellKeys: [], summary: SUMMARY });
    expect(o.cellLabel).toBe("this market");
    expect(o.standardRows).toEqual([]);
    expect(o.cohorts).toHaveLength(3);
  });
});
