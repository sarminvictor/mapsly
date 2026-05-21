// Integration tests for daily/new-reviews-delta handler.
//
// Mocks `@/lib/prisma` (in-memory store) + `@/services/dataforseo` so the
// handler logic, anonymization, delta-detection, and revalidate behavior
// are exercised end-to-end without touching Neon or DataForSEO.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- Test seam state ----------------------------------------------------

interface FakeBusiness {
  id: string;
  slug: string;
  googleCid: string | null;
  reviewCount: number | null;
  rating: number | null;
  country: string | null;
  isActive: boolean;
  lastRefreshedAt: Date | null;
  name?: string;
}
interface FakeReview {
  id: string;
  businessId: string;
  externalId: string | null;
  collectedAt: Date;
}
interface FakeCronRun {
  id: string;
  job: string;
  costUsd: number;
  finishedAt: Date | null;
  status: string;
  itemsProcessed: number;
  meta: Record<string, unknown> | null;
  errorMessage: string | null;
}

const db = {
  businesses: new Map<string, FakeBusiness>(),
  reviews: new Map<string, FakeReview>(),
  cronRuns: new Map<string, FakeCronRun>(),
  nextRunId: 1,
  nextReviewId: 1,
  reset() {
    this.businesses.clear();
    this.reviews.clear();
    this.cronRuns.clear();
    this.nextRunId = 1;
    this.nextReviewId = 1;
  },
};

// ---- Mocks --------------------------------------------------------------

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    business: {
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: { isActive: boolean; googleCid: { not: null }; NOT?: unknown };
          take: number;
          select: unknown;
        }) => {
          return Array.from(db.businesses.values())
            .filter((b) => {
              if (where.isActive && !b.isActive) return false;
              if (b.googleCid == null) return false;
              return true;
            })
            .slice(0, take);
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakeBusiness>;
        }) => {
          const row = db.businesses.get(where.id);
          if (!row) throw new Error("not found");
          Object.assign(row, data);
          return row;
        },
      ),
    },
    review: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            businessId: string;
            externalId: { in: string[] };
          };
          select: unknown;
        }) => {
          return Array.from(db.reviews.values())
            .filter(
              (r) =>
                r.businessId === where.businessId &&
                r.externalId != null &&
                where.externalId.in.includes(r.externalId),
            )
            .map((r) => ({ externalId: r.externalId }));
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            businessId: string;
            externalId: string;
          };
        }) => {
          const id = `rev_${db.nextReviewId++}`;
          const row: FakeReview = {
            id,
            businessId: data.businessId,
            externalId: data.externalId,
            collectedAt: new Date(),
          };
          db.reviews.set(id, row);
          return row;
        },
      ),
    },
    cronRun: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { job: string; status: string; costUsd?: number };
        }) => {
          const id = `run_${db.nextRunId++}`;
          const row: FakeCronRun = {
            id,
            job: data.job,
            costUsd: data.costUsd ?? 0,
            status: data.status,
            finishedAt: null,
            itemsProcessed: 0,
            meta: null,
            errorMessage: null,
          };
          db.cronRuns.set(id, row);
          return { id, job: data.job, startedAt: new Date() };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = db.cronRuns.get(where.id);
          if (!row) throw new Error("not found");
          if (typeof data.status === "string") row.status = data.status;
          if (data.finishedAt instanceof Date) row.finishedAt = data.finishedAt;
          if (typeof data.itemsProcessed === "number")
            row.itemsProcessed = data.itemsProcessed;
          if (typeof data.errorMessage === "string")
            row.errorMessage = data.errorMessage;
          if (data.meta && typeof data.meta === "object")
            row.meta = data.meta as Record<string, unknown>;
          if (
            data.costUsd &&
            typeof data.costUsd === "object" &&
            "increment" in (data.costUsd as Record<string, unknown>)
          ) {
            row.costUsd += (data.costUsd as { increment: number }).increment;
          }
          return row;
        },
      ),
    },
  },
}));

vi.mock("@/services/dataforseo", () => ({
  reviewsPull: vi.fn(),
}));

import * as svc from "@/services/dataforseo";
import {
  GET,
  reviewItemToPersist,
  anonymizeReviewerName,
} from "../new-reviews-delta/route";

const reviewsPullMock = svc.reviewsPull as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  db.reset();
  reviewsPullMock.mockReset();
  process.env.CRON_SECRET = "test-secret-abc";
});

afterEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function authedRequest() {
  return new Request("https://x/y", {
    headers: { authorization: "Bearer test-secret-abc" },
  });
}

// ---- Pure helpers tests -------------------------------------------------

describe("anonymizeReviewerName", () => {
  test("two-word name → initials", () => {
    expect(anonymizeReviewerName("John Doe")).toBe("J.D");
  });
  test("single name → first letter", () => {
    expect(anonymizeReviewerName("Madonna")).toBe("M");
  });
  test("missing → Anon", () => {
    expect(anonymizeReviewerName(null)).toBe("Anon");
    expect(anonymizeReviewerName("")).toBe("Anon");
    expect(anonymizeReviewerName("   ")).toBe("Anon");
  });
  test("triple-barreled → first 3 initials", () => {
    expect(anonymizeReviewerName("Aaron Burr Hamilton")).toBe("A.B.H");
  });
});

describe("reviewItemToPersist", () => {
  test("returns null without review_id", () => {
    expect(
      reviewItemToPersist(
        {
          rating: { value: 5 },
          timestamp: "2026-05-19T00:00:00Z",
        },
        "b1",
      ),
    ).toBeNull();
  });
  test("returns null without rating", () => {
    expect(
      reviewItemToPersist(
        {
          review_id: "r1",
          timestamp: "2026-05-19T00:00:00Z",
        },
        "b1",
      ),
    ).toBeNull();
  });
  test("clamps stars to 1..5", () => {
    const row = reviewItemToPersist(
      {
        review_id: "r1",
        rating: { value: 4.7 },
        timestamp: "2026-05-19T00:00:00Z",
        profile_name: "Jane Smith",
        review_text: "Great spa",
        owner_answer: "Thanks Jane!",
      },
      "b1",
    );
    expect(row).not.toBeNull();
    expect(row!.stars).toBe(5);
    expect(row!.reviewerName).toBe("J.S");
    expect(row!.text).toBe("Great spa");
    expect(row!.ownerReplied).toBe(true);
    expect(row!.ownerReplyText).toBe("Thanks Jane!");
  });
});

// ---- Handler integration tests -----------------------------------------

describe("daily/new-reviews-delta · cron handler", () => {
  test("rejects unauthorized", async () => {
    const res = await GET(new Request("https://x/y"));
    expect(res.status).toBe(401);
  });

  test("no candidate businesses → OK 0 items", async () => {
    reviewsPullMock.mockResolvedValue({
      items: [],
      aggregateRating: null,
      totalReviewsCount: null,
      operation: "dataforseo.reviews.pull",
    });
    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; itemsProcessed: number };
    expect(body.ok).toBe(true);
    expect(body.itemsProcessed).toBe(0);
  });

  test("happy path · 1 business, 1 new review", async () => {
    db.businesses.set("b1", {
      id: "b1",
      slug: "solea-spa",
      googleCid: "1234567890",
      reviewCount: 50,
      rating: 4.6,
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
      name: "Solea Spa",
    });
    reviewsPullMock.mockResolvedValueOnce({
      items: [
        {
          review_id: "google_r1",
          rating: { value: 5 },
          timestamp: "2026-05-19T10:00:00Z",
          profile_name: "Alice Cooper",
          review_text: "Loved the facial.",
        },
      ],
      aggregateRating: 4.7,
      totalReviewsCount: 51,
      operation: "dataforseo.reviews.pull",
    });

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; itemsProcessed: number };
    expect(body.itemsProcessed).toBe(1);

    const stored = Array.from(db.reviews.values()).filter(
      (r) => r.businessId === "b1",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].externalId).toBe("google_r1");

    const business = db.businesses.get("b1")!;
    expect(business.reviewCount).toBe(51);
    expect(business.rating).toBe(4.7);
  });

  test("dedupes already-known review by externalId", async () => {
    db.businesses.set("b1", {
      id: "b1",
      slug: "solea-spa",
      googleCid: "1234567890",
      reviewCount: 50,
      rating: 4.6,
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
    });
    // pre-seed an existing review
    db.reviews.set("rev_pre", {
      id: "rev_pre",
      businessId: "b1",
      externalId: "google_r1",
      collectedAt: new Date(0),
    });
    reviewsPullMock.mockResolvedValueOnce({
      items: [
        {
          review_id: "google_r1", // duplicate
          rating: { value: 4 },
          timestamp: "2026-05-19T10:00:00Z",
        },
        {
          review_id: "google_r2",
          rating: { value: 5 },
          timestamp: "2026-05-19T11:00:00Z",
        },
      ],
      aggregateRating: 4.65,
      totalReviewsCount: 52,
      operation: "dataforseo.reviews.pull",
    });

    await GET(authedRequest());

    const stored = Array.from(db.reviews.values()).filter(
      (r) => r.businessId === "b1",
    );
    // Should be original + 1 new; google_r1 dedup'd
    expect(stored).toHaveLength(2);
    const externals = stored.map((r) => r.externalId).sort();
    expect(externals).toEqual(["google_r1", "google_r2"]);
  });

  test("no-op short-circuit when count + rating unchanged", async () => {
    db.businesses.set("b1", {
      id: "b1",
      slug: "x",
      googleCid: "cid",
      reviewCount: 50,
      rating: 4.6,
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
    });
    reviewsPullMock.mockResolvedValueOnce({
      items: [
        {
          review_id: "ignored_r",
          rating: { value: 5 },
          timestamp: "2026-05-19T10:00:00Z",
        },
      ],
      aggregateRating: 4.6,
      totalReviewsCount: 50,
      operation: "dataforseo.reviews.pull",
    });

    await GET(authedRequest());

    // No review inserts because count matched and rating matched.
    expect(db.reviews.size).toBe(0);
  });

  test("adapter error on one biz → PARTIAL not crash", async () => {
    db.businesses.set("b1", {
      id: "b1",
      slug: "a",
      googleCid: "cid1",
      reviewCount: 10,
      rating: 4,
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
    });
    db.businesses.set("b2", {
      id: "b2",
      slug: "b",
      googleCid: "cid2",
      reviewCount: 20,
      rating: 4.5,
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
    });
    reviewsPullMock.mockImplementation(async (q: { cid?: string }) => {
      if (q.cid === "cid1") throw new Error("upstream-503");
      return {
        items: [
          {
            review_id: "good_r",
            rating: { value: 5 },
            timestamp: "2026-05-19T11:00:00Z",
          },
        ],
        aggregateRating: 4.6,
        totalReviewsCount: 21,
        operation: "dataforseo.reviews.pull",
      };
    });

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { itemsProcessed: number };
    expect(body.itemsProcessed).toBe(1);

    // Look at the CronRun row — it should have status PARTIAL
    const runs = Array.from(db.cronRuns.values());
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("PARTIAL");
    expect(runs[0].itemsProcessed).toBe(1);
    expect(runs[0].meta?.failed).toBe(1);
  });
});
