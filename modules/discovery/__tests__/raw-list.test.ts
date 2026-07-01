// Unit tests for the Raw List read model (Phase 2).
//
// `rawListWhere` is pure (no DB) so its shape is asserted directly.
// `getRawList` + `getRawListSummary` are exercised against an in-memory prisma
// mock to lock the cursor + summary-count contracts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── In-memory Business store ──────────────────────────────────────────────

interface FakeBiz {
  id: string;
  cellKey: string | null;
  // null = unscanned (freshly discovered) — must stay VISIBLE; only a
  // scanned-and-unreachable row (true) is hidden. See rawListWhere `{ not: true }`.
  isHidden: boolean | null;
  openStatus: string;
  reachableChannelCount: number;
  reachability: string;
  reviewCount: number | null;
  website: string | null;
  rating: number | null;
  metroSlug: string | null;
}

const db = {
  businesses: [] as FakeBiz[],
  reset() {
    this.businesses = [];
  },
};

function matches(b: FakeBiz, where: any): boolean {
  if (where.cellKey?.in) {
    if (!b.cellKey || !where.cellKey.in.includes(b.cellKey)) return false;
  }
  if (where.isHidden === false && b.isHidden) return false;
  if (where.isHidden === true && !b.isHidden) return false;
  // `{ not: true }` — exclude ONLY scanned-hidden rows; unscanned (null) stays.
  if (where.isHidden?.not === true && b.isHidden === true) return false;
  if (where.openStatus?.not && b.openStatus === where.openStatus.not) {
    return false;
  }
  if (where.website?.not === null && b.website === null) return false;
  if (where.rating?.gte != null && (b.rating ?? -1) < where.rating.gte) {
    return false;
  }
  if (
    where.reviewCount?.gte != null &&
    (b.reviewCount ?? -1) < where.reviewCount.gte
  ) {
    return false;
  }
  if (
    where.reachability?.in &&
    !where.reachability.in.includes(b.reachability)
  ) {
    return false;
  }
  if (where.reachability && typeof where.reachability === "string") {
    if (b.reachability !== where.reachability) return false;
  }
  if (where.reachableChannelCount?.gt != null) {
    if (b.reachableChannelCount <= where.reachableChannelCount.gt) return false;
  }
  if (where.metroSlug && b.metroSlug !== where.metroSlug) return false;
  return true;
}

vi.mock("@/lib/prisma", () => {
  const business = {
    findMany: vi.fn(
      async ({
        where,
        take,
        cursor,
        skip,
      }: {
        where: any;
        take: number;
        cursor?: { id: string };
        skip?: number;
        orderBy?: unknown;
        select?: unknown;
      }) => {
        let rows = db.businesses
          .filter((b) => matches(b, where))
          .sort(
            (a, c) =>
              (c.reviewCount ?? 0) - (a.reviewCount ?? 0) ||
              a.id.localeCompare(c.id),
          );
        if (cursor) {
          const idx = rows.findIndex((r) => r.id === cursor.id);
          rows = idx >= 0 ? rows.slice(idx + (skip ?? 0)) : rows;
        }
        return rows.slice(0, take).map((r) => ({ ...r }));
      },
    ),
    count: vi.fn(async ({ where }: { where: any }) => {
      return db.businesses.filter((b) => matches(b, where)).length;
    }),
  };
  return {
    default: {
      business,
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
    Prisma: {},
  };
});

// ─── Import under test AFTER the mock ──────────────────────────────────────

import { getRawList, getRawListSummary, rawListWhere } from "../raw-list";

beforeEach(() => db.reset());
afterEach(() => vi.clearAllMocks());

// ─── rawListWhere (pure) ────────────────────────────────────────────────────

describe("rawListWhere · default exclusions", () => {
  test("scopes to cellKeys and excludes hidden + closed-forever by default", () => {
    const where = rawListWhere({ cellKeys: ["medical_spa|miami|US"] });
    expect(where.cellKey).toEqual({ in: ["medical_spa|miami|US"] });
    // `{ not: true }` (not `false`) so unscanned (isHidden null) rows stay visible.
    expect(where.isHidden).toEqual({ not: true });
    expect(where.openStatus).toEqual({ not: "CLOSED_FOREVER" });
  });

  test("empty cellKeys yields an impossible-match (never full-table scan)", () => {
    const where = rawListWhere({ cellKeys: [] });
    expect(where.cellKey).toEqual({ in: ["__never__"] });
  });

  test("includeHidden / includeClosed drop the default exclusions", () => {
    const where = rawListWhere({
      cellKeys: ["c1"],
      includeHidden: true,
      includeClosed: true,
    });
    expect(where.isHidden).toBeUndefined();
    expect(where.openStatus).toBeUndefined();
  });
});

describe("rawListWhere · filters", () => {
  test("applies hasWebsite / minRating / minReviewCount / reachability / metroSlug", () => {
    const where = rawListWhere({
      cellKeys: ["c1"],
      filters: {
        hasWebsite: true,
        minRating: 4,
        minReviewCount: 10,
        reachability: ["MULTI", "RICH"],
        metroSlug: "miami",
      },
    });
    expect(where.website).toEqual({ not: null });
    expect(where.rating).toEqual({ gte: 4 });
    expect(where.reviewCount).toEqual({ gte: 10 });
    expect(where.reachability).toEqual({ in: ["MULTI", "RICH"] });
    expect(where.metroSlug).toBe("miami");
  });

  test("hasWebsite:false does not add a website clause", () => {
    const where = rawListWhere({
      cellKeys: ["c1"],
      filters: { hasWebsite: false },
    });
    expect(where.website).toBeUndefined();
  });
});

// ─── getRawList + summary (mocked DB) ──────────────────────────────────────

function seed(partial: Partial<FakeBiz> & { id: string }) {
  db.businesses.push({
    id: partial.id,
    cellKey: partial.cellKey ?? "c1",
    isHidden: partial.isHidden ?? false,
    openStatus: partial.openStatus ?? "OPEN",
    reachableChannelCount: partial.reachableChannelCount ?? 0,
    reachability: partial.reachability ?? "UNKNOWN",
    reviewCount: partial.reviewCount ?? 0,
    website: partial.website ?? null,
    rating: partial.rating ?? null,
    metroSlug: partial.metroSlug ?? "miami",
  });
}

describe("getRawList", () => {
  test("excludes hidden + closed-forever, returns a cursor when more remain", async () => {
    seed({ id: "b1", reviewCount: 30 });
    seed({ id: "b2", reviewCount: 20 });
    seed({ id: "b3", reviewCount: 10 });
    seed({ id: "hidden", isHidden: true, reviewCount: 99 });
    seed({ id: "closed", openStatus: "CLOSED_FOREVER", reviewCount: 99 });

    const page = await getRawList({ cellKeys: ["c1"] }, { take: 2 });
    expect(page.rows.map((r) => r.id)).toEqual(["b1", "b2"]);
    expect(page.nextCursor).toBe("b3");
  });

  test("last page has a null cursor", async () => {
    seed({ id: "b1", reviewCount: 30 });
    const page = await getRawList({ cellKeys: ["c1"] }, { take: 10 });
    expect(page.rows.map((r) => r.id)).toEqual(["b1"]);
    expect(page.nextCursor).toBeNull();
  });

  test("keeps unscanned (isHidden null) businesses visible", async () => {
    seed({ id: "scanned", isHidden: false, reviewCount: 10 });
    seed({ id: "unscanned", isHidden: null, reviewCount: 20 });
    seed({ id: "hidden", isHidden: true, reviewCount: 99 });
    const page = await getRawList({ cellKeys: ["c1"] }, { take: 10 });
    // Only the scanned-and-hidden row is dropped; the unscanned (null) row stays.
    expect(page.rows.map((r) => r.id)).toEqual(["unscanned", "scanned"]);
  });
});

describe("getRawListSummary", () => {
  test("counts total / reachable / phoneOnly / hidden", async () => {
    seed({ id: "b1", reachableChannelCount: 2, reachability: "MULTI" });
    seed({ id: "b2", reachableChannelCount: 1, reachability: "PHONE_ONLY" });
    seed({ id: "b3", reachableChannelCount: 0, reachability: "UNREACHABLE" });
    seed({ id: "hidden", isHidden: true, reachableChannelCount: 5 });
    seed({ id: "closed", openStatus: "CLOSED_FOREVER" });

    const s = await getRawListSummary({ cellKeys: ["c1"] });
    // total = default-excluded view (b1, b2, b3) — hidden + closed removed.
    expect(s.total).toBe(3);
    expect(s.reachable).toBe(2); // b1 + b2 have channels > 0
    expect(s.phoneOnly).toBe(1); // b2
    expect(s.hidden).toBe(1); // the suppressed row
  });
});
