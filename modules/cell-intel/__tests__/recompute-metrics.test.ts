// Tests for recomputeCellMetric + the reused `quantiles` percentile helper.
//
//   1. `quantiles` computes correct interpolated percentiles (golden values).
//   2. recomputeCellMetric upserts a CellMetric row with confidence="high"
//      when sampleSize ≥ 8, "low" when < 8, and clears metricsDirty.
//   3. an empty cell writes no row but clears the dirty flag.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- prisma mock --------------------------------------------------------
interface Snap {
  businessId: string;
  snapshotDate: Date;
  signalsJson: unknown;
  rating: number | null;
  reviewCount: number | null;
  photosCount: number | null;
  replyRate: number | null;
  velocityLast30d: number | null;
}

const db = vi.hoisted(() => {
  const upserts: Array<Record<string, unknown>> = [];
  const updateManys: Array<Record<string, unknown>> = [];
  let snapshots: Snap[] = [];
  let keywordRows: Array<{
    businessId: string;
    latestEstMonthlyVisits: number | null;
  }> = [];
  let serpRows: Array<{ businessId: string; organicRank: number | null }> = [];
  return {
    upserts,
    updateManys,
    setSnapshots(s: Snap[]) {
      snapshots = s;
    },
    getSnapshots() {
      return snapshots;
    },
    setKeywordRows(
      r: Array<{ businessId: string; latestEstMonthlyVisits: number | null }>,
    ) {
      keywordRows = r;
    },
    getKeywordRows() {
      return keywordRows;
    },
    setSerpRows(r: Array<{ businessId: string; organicRank: number | null }>) {
      serpRows = r;
    },
    getSerpRows() {
      return serpRows;
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    businessSnapshot: {
      findMany: vi.fn(async () => db.getSnapshots()),
    },
    // Organic distribution pull (Cluster C) — empty in these tests; the helper
    // simply contributes no organic breakpoints, which is what we assert below.
    businessKeyword: {
      findMany: vi.fn(async () => db.getKeywordRows()),
    },
    serpResult: {
      findMany: vi.fn(async () => db.getSerpRows()),
    },
    cellMetric: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        db.upserts.push(args);
        return { id: `cm_${db.upserts.length}` };
      }),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        db.updateManys.push(args);
        return { count: 1 };
      }),
    },
  },
  Prisma: { JsonNull: null },
}));

import {
  organicDistributionsForBusinesses,
  quantiles,
} from "@/modules/market/cell-metrics";
import { recomputeCellMetric } from "../recompute-metrics";

const CELL = "medical_spa|miami|US";
const NOW = new Date("2026-06-22T12:00:00.000Z");

function snap(rating: number, reviewCount: number, businessId = "b0"): Snap {
  return {
    businessId,
    snapshotDate: NOW,
    signalsJson: null,
    rating,
    reviewCount,
    photosCount: null,
    replyRate: null,
    velocityLast30d: null,
  };
}

beforeEach(() => {
  db.upserts.length = 0;
  db.updateManys.length = 0;
  db.setSnapshots([]);
  db.setKeywordRows([]);
  db.setSerpRows([]);
});

afterEach(() => vi.clearAllMocks());

describe("quantiles · golden percentiles", () => {
  test("1..10 → linear-interpolated breakpoints", () => {
    const bp = quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(bp).not.toBeNull();
    // idx = (n-1)*p over a sorted 1..10 array.
    expect(bp!.p10).toBeCloseTo(1.9, 6);
    expect(bp!.p25).toBeCloseTo(3.25, 6);
    expect(bp!.p50).toBeCloseTo(5.5, 6);
    expect(bp!.p75).toBeCloseTo(7.75, 6);
    expect(bp!.p90).toBeCloseTo(9.1, 6);
  });

  test("unsorted input is sorted first", () => {
    const bp = quantiles([10, 1, 5, 3, 8, 2, 9, 4, 7, 6]);
    expect(bp!.p50).toBeCloseTo(5.5, 6);
  });

  test("single value → all percentiles equal that value", () => {
    const bp = quantiles([42]);
    expect(bp).toEqual({ p10: 42, p25: 42, p50: 42, p75: 42, p90: 42 });
  });

  test("empty → null", () => {
    expect(quantiles([])).toBeNull();
  });
});

describe("recomputeCellMetric · confidence by sample size", () => {
  test("≥8 snapshots → confidence high, metricsDirty cleared", async () => {
    db.setSnapshots(
      Array.from({ length: 8 }, (_, i) => snap(4 + i * 0.1, 50 + i * 10)),
    );
    const res = await recomputeCellMetric(CELL, { now: NOW });
    expect(res.outcome).toBe("written");
    expect(res.sampleSize).toBe(8);
    expect(res.confidence).toBe("high");
    expect(db.upserts).toHaveLength(1);
    const create = (db.upserts[0] as { create: Record<string, unknown> })
      .create;
    expect(create.confidence).toBe("high");
    expect(create.sampleSize).toBe(8);
    expect(create.metricsDirty).toBe(false);
    expect(create.cellKey).toBe(CELL);
    // category/city/country derived from the cellKey parts.
    expect(create.category).toBe("medical_spa");
    expect(create.city).toBe("miami");
    expect(create.country).toBe("US");
  });

  test("<8 snapshots → confidence low", async () => {
    db.setSnapshots([snap(4.1, 30), snap(4.4, 60), snap(4.8, 90)]);
    const res = await recomputeCellMetric(CELL, { now: NOW });
    expect(res.confidence).toBe("low");
    expect(res.sampleSize).toBe(3);
    const create = (db.upserts[0] as { create: Record<string, unknown> })
      .create;
    expect(create.confidence).toBe("low");
    // p50 of [30,60,90] = 60.
    expect(create.reviewCountP50).toBe(60);
    // p50 of ratings [4.1,4.4,4.8] = 4.4.
    expect(create.ratingP50).toBeCloseTo(4.4, 6);
  });

  test("empty cell → no row written, dirty flag cleared", async () => {
    db.setSnapshots([]);
    const res = await recomputeCellMetric(CELL, { now: NOW });
    expect(res.outcome).toBe("empty");
    expect(res.sampleSize).toBe(0);
    expect(db.upserts).toHaveLength(0);
    expect(db.updateManys).toHaveLength(1);
    const data = (db.updateManys[0] as { data: Record<string, unknown> }).data;
    expect(data.metricsDirty).toBe(false);
  });

  test("malformed cellKey throws", async () => {
    await expect(recomputeCellMetric("bad-key", { now: NOW })).rejects.toThrow(
      /malformed cellKey/,
    );
  });

  test("folds organic-traffic + organic-rank distributions into the written row", async () => {
    db.setSnapshots(
      Array.from({ length: 8 }, (_, i) => snap(4.5, 50, `b${i}`)),
    );
    // 2 keyword rows for one business → its organic-traffic value = 30+12 = 42.
    db.setKeywordRows([
      { businessId: "b0", latestEstMonthlyVisits: 30 },
      { businessId: "b0", latestEstMonthlyVisits: 12 },
      { businessId: "b1", latestEstMonthlyVisits: 100 },
    ]);
    // best (lowest) organic rank per business.
    db.setSerpRows([
      { businessId: "b0", organicRank: 8 },
      { businessId: "b0", organicRank: 3 },
      { businessId: "b1", organicRank: 5 },
    ]);
    await recomputeCellMetric(CELL, { now: NOW });
    const create = (db.upserts[0] as { create: Record<string, unknown> })
      .create;
    const dist = create.distributions as Record<
      string,
      { p50: number } | undefined
    >;
    expect(dist.organicTraffic).toBeDefined();
    expect(dist.organicRank).toBeDefined();
    // organic-traffic values [42, 100] → p50 = 71.
    expect(dist.organicTraffic!.p50).toBeCloseTo(71, 6);
    // best-rank values [3, 5] → p50 = 4.
    expect(dist.organicRank!.p50).toBeCloseTo(4, 6);
  });
});

describe("organicDistributionsForBusinesses", () => {
  test("sums est visits per business + takes best organic rank per business", async () => {
    db.setKeywordRows([
      { businessId: "b1", latestEstMonthlyVisits: 30 },
      { businessId: "b1", latestEstMonthlyVisits: 20 }, // b1 → 50
      { businessId: "b2", latestEstMonthlyVisits: 200 }, // b2 → 200
      { businessId: "b3", latestEstMonthlyVisits: null }, // ignored
    ]);
    db.setSerpRows([
      { businessId: "b1", organicRank: 12 },
      { businessId: "b1", organicRank: 4 }, // b1 best → 4
      { businessId: "b2", organicRank: 9 }, // b2 best → 9
      { businessId: "b3", organicRank: null }, // ignored
    ]);
    const { organicTraffic, organicRank } =
      await organicDistributionsForBusinesses(["b1", "b2", "b3"]);
    // traffic values [50, 200] → p50 = 125.
    expect(organicTraffic!.p50).toBeCloseTo(125, 6);
    // rank values [4, 9] → p50 = 6.5.
    expect(organicRank!.p50).toBeCloseTo(6.5, 6);
  });

  test("empty id list → both null (no query)", async () => {
    const r = await organicDistributionsForBusinesses([]);
    expect(r.organicTraffic).toBeNull();
    expect(r.organicRank).toBeNull();
  });
});
