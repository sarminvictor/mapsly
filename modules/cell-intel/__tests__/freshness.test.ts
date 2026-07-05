// Unit tests for the per-cell freshness gate (pure time math) + the R2
// dead-letter query (cellsDueForMetaRetry).

import { beforeEach, describe, expect, test, vi } from "vitest";

// ---- prisma mock (for cellsDueForMetaRetry) -----------------------------
// A tiny in-memory AdMarketRun table. `findMany` returns the FAILED candidates
// past the cutoff (newest first); `findFirst` returns a cell's latest run.
const db = vi.hoisted(() => {
  type Row = { cellKey: string; platform: string; status: string; ranAt: Date };
  const rows: Row[] = [];
  return {
    rows,
    reset() {
      rows.length = 0;
    },
    add(r: Row) {
      rows.push(r);
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    adMarketRun: {
      findMany: vi.fn(
        async (args: {
          where: {
            platform: string;
            status: string;
            ranAt?: { lt: Date };
          };
          take?: number;
        }) => {
          const { where } = args;
          return db.rows
            .filter(
              (r) =>
                r.platform === where.platform &&
                r.status === where.status &&
                (!where.ranAt || r.ranAt < where.ranAt.lt),
            )
            .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
            .slice(0, args.take ?? 1000)
            .map((r) => ({ cellKey: r.cellKey, ranAt: r.ranAt }));
        },
      ),
      // Newest run overall per candidate cell (replaces the old per-cell
      // findFirst — one batched groupBy, CODE-REVIEW #1).
      groupBy: vi.fn(
        async (args: {
          by: string[];
          where: { cellKey: { in: string[] }; platform: string };
          _max: { ranAt: true };
        }) => {
          const cells = new Set(args.where.cellKey.in);
          const maxByCell = new Map<string, Date>();
          for (const r of db.rows) {
            if (r.platform !== args.where.platform) continue;
            if (!cells.has(r.cellKey)) continue;
            const cur = maxByCell.get(r.cellKey);
            if (!cur || r.ranAt > cur) maxByCell.set(r.cellKey, r.ranAt);
          }
          return [...maxByCell.entries()].map(([cellKey, ranAt]) => ({
            cellKey,
            _max: { ranAt },
          }));
        },
      ),
    },
  },
}));

import {
  isCellRunFresh,
  CELL_INTEL_FRESHNESS_DAYS,
  cellsDueForMetaRetry,
  META_RETRY_BACKOFF_HOURS,
} from "../freshness";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = new Date("2026-06-22T12:00:00.000Z");

describe("isCellRunFresh", () => {
  test("null (never run) is always stale", () => {
    expect(isCellRunFresh(null, NOW)).toBe(false);
  });

  test("a run from today is fresh", () => {
    expect(isCellRunFresh(new Date(NOW.getTime() - DAY), NOW)).toBe(true);
  });

  test("exactly at the boundary (30d) is still fresh", () => {
    const at = new Date(NOW.getTime() - CELL_INTEL_FRESHNESS_DAYS * DAY);
    expect(isCellRunFresh(at, NOW)).toBe(true);
  });

  test("one day past the window is stale", () => {
    const at = new Date(NOW.getTime() - (CELL_INTEL_FRESHNESS_DAYS + 1) * DAY);
    expect(isCellRunFresh(at, NOW)).toBe(false);
  });

  test("a future run (clock skew) is treated as fresh", () => {
    expect(isCellRunFresh(new Date(NOW.getTime() + DAY), NOW)).toBe(true);
  });

  test("custom window is honoured", () => {
    const at = new Date(NOW.getTime() - 5 * DAY);
    expect(isCellRunFresh(at, NOW, 3)).toBe(false);
    expect(isCellRunFresh(at, NOW, 7)).toBe(true);
  });
});

describe("cellsDueForMetaRetry · R2 dead-letter", () => {
  beforeEach(() => db.reset());

  test("returns a cell whose latest META run is a FAILED marker past the backoff", async () => {
    db.add({
      cellKey: "barber_shop|kelowna|CA",
      platform: "META",
      status: "FAILED",
      ranAt: new Date(NOW.getTime() - (META_RETRY_BACKOFF_HOURS + 1) * HOUR),
    });
    const due = await cellsDueForMetaRetry(NOW);
    expect(due).toEqual(["barber_shop|kelowna|CA"]);
  });

  test("excludes a FAILED cell still inside the backoff window", async () => {
    db.add({
      cellKey: "recent|fail|US",
      platform: "META",
      status: "FAILED",
      ranAt: new Date(NOW.getTime() - 1 * HOUR), // too recent
    });
    const due = await cellsDueForMetaRetry(NOW);
    expect(due).toEqual([]);
  });

  test("excludes a cell that later succeeded (OK newer than the FAILED marker)", async () => {
    const cell = "recovered|cell|US";
    db.add({
      cellKey: cell,
      platform: "META",
      status: "FAILED",
      ranAt: new Date(NOW.getTime() - 10 * HOUR),
    });
    db.add({
      cellKey: cell,
      platform: "META",
      status: "OK", // a success landed AFTER the failure
      ranAt: new Date(NOW.getTime() - 2 * HOUR),
    });
    const due = await cellsDueForMetaRetry(NOW);
    expect(due).toEqual([]);
  });

  test("dedupes a cell with multiple FAILED markers to a single entry", async () => {
    const cell = "double|fail|US";
    db.add({
      cellKey: cell,
      platform: "META",
      status: "FAILED",
      ranAt: new Date(NOW.getTime() - 20 * HOUR),
    });
    db.add({
      cellKey: cell,
      platform: "META",
      status: "FAILED",
      ranAt: new Date(NOW.getTime() - 8 * HOUR),
    });
    const due = await cellsDueForMetaRetry(NOW);
    expect(due).toEqual([cell]);
  });

  test("ignores non-META FAILED runs (SERP/GOOGLE)", async () => {
    db.add({
      cellKey: "serp|only|US",
      platform: "SERP",
      status: "FAILED",
      ranAt: new Date(NOW.getTime() - 24 * HOUR),
    });
    const due = await cellsDueForMetaRetry(NOW);
    expect(due).toEqual([]);
  });

  test("honours a custom backoff + respects the limit", async () => {
    for (let i = 0; i < 5; i++) {
      db.add({
        cellKey: `cell${i}|x|US`,
        platform: "META",
        status: "FAILED",
        ranAt: new Date(NOW.getTime() - (3 + i) * HOUR),
      });
    }
    // backoff 2h → all 5 are eligible; limit 2 → only 2 returned.
    const due = await cellsDueForMetaRetry(NOW, { backoffHours: 2, limit: 2 });
    expect(due).toHaveLength(2);
  });
});
