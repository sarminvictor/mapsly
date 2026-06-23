// Tests for recomputeCellMetric + the reused `quantiles` percentile helper.
//
//   1. `quantiles` computes correct interpolated percentiles (golden values).
//   2. recomputeCellMetric upserts a CellMetric row with confidence="high"
//      when sampleSize ≥ 8, "low" when < 8, and clears metricsDirty.
//   3. an empty cell writes no row but clears the dirty flag.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- prisma mock --------------------------------------------------------
interface Snap {
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
  return {
    upserts,
    updateManys,
    setSnapshots(s: Snap[]) {
      snapshots = s;
    },
    getSnapshots() {
      return snapshots;
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    businessSnapshot: {
      findMany: vi.fn(async () => db.getSnapshots()),
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

import { quantiles } from "@/modules/market/cell-metrics";
import { recomputeCellMetric } from "../recompute-metrics";

const CELL = "medical_spa|miami|US";
const NOW = new Date("2026-06-22T12:00:00.000Z");

function snap(rating: number, reviewCount: number): Snap {
  return {
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
});
