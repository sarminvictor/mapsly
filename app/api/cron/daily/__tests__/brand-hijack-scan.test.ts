// Integration tests for daily/brand-hijack-scan handler.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeBusiness {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  isActive: boolean;
  lastRefreshedAt: Date | null;
  serpResults?: Array<{ scannedAt: Date; isBrandQuery: boolean }>;
}
interface FakeKeyword {
  id: string;
  keyword: string;
  locationCode: number;
  language: string;
}
interface FakeSerpResult {
  id: string;
  businessId: string;
  keywordId: string;
  scannedAt: Date;
  organicRank: number | null;
  isBrandQuery: boolean;
  paidBidders: unknown;
}
interface FakeCronRun {
  id: string;
  job: string;
  costUsd: number;
  status: string;
  finishedAt: Date | null;
  itemsProcessed: number;
  meta: Record<string, unknown> | null;
}

const db = {
  businesses: new Map<string, FakeBusiness>(),
  keywords: new Map<string, FakeKeyword>(),
  serpResults: [] as FakeSerpResult[],
  cronRuns: new Map<string, FakeCronRun>(),
  nextId: 1,
  reset() {
    this.businesses.clear();
    this.keywords.clear();
    this.serpResults = [];
    this.cronRuns.clear();
    this.nextId = 1;
  },
};

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  default: {
    business: {
      findMany: vi.fn(async ({ take }: { take: number; where: unknown }) => {
        return Array.from(db.businesses.values())
          .filter((b) => b.isActive && b.name)
          .slice(0, take);
      }),
    },
    keyword: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            keyword_locationCode_language: {
              keyword: string;
              locationCode: number;
              language: string;
            };
          };
        }) => {
          const c = where.keyword_locationCode_language;
          for (const k of db.keywords.values()) {
            if (
              k.keyword === c.keyword &&
              k.locationCode === c.locationCode &&
              k.language === c.language
            ) {
              return k;
            }
          }
          return null;
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: { keyword: string; locationCode: number; language: string };
        }) => {
          const id = `kw_${db.nextId++}`;
          const row: FakeKeyword = { id, ...data };
          db.keywords.set(id, row);
          return row;
        },
      ),
    },
    serpResult: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            businessId: string;
            keywordId: string;
            scannedAt: Date;
            organicRank: number | null;
            isBrandQuery: boolean;
            paidBidders: unknown;
          };
        }) => {
          const row: FakeSerpResult = { id: `sr_${db.nextId++}`, ...data };
          db.serpResults.push(row);
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
          const id = `run_${db.nextId++}`;
          db.cronRuns.set(id, {
            id,
            job: data.job,
            costUsd: data.costUsd ?? 0,
            status: data.status,
            finishedAt: null,
            itemsProcessed: 0,
            meta: null,
          });
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
  serpOrganic: vi.fn(),
}));

import * as svc from "@/services/dataforseo";
import { GET, __test } from "../brand-hijack-scan/route";

const serpOrganicMock = svc.serpOrganic as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  db.reset();
  serpOrganicMock.mockReset();
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

describe("locationCodeForCountry", () => {
  test("US default", () =>
    expect(__test.locationCodeForCountry(null)).toBe(2840));
  test("CA → 2124", () =>
    expect(__test.locationCodeForCountry("CA")).toBe(2124));
  test("GB → 2826", () =>
    expect(__test.locationCodeForCountry("GB")).toBe(2826));
  test("AU → 2036", () =>
    expect(__test.locationCodeForCountry("AU")).toBe(2036));
  test("unknown → US fallback", () =>
    expect(__test.locationCodeForCountry("ZZ")).toBe(2840));
});

describe("clampLimitFromEnv", () => {
  test("default when env unset", () => {
    delete process.env.CRON_DAILY_LIMIT;
    expect(__test.clampLimitFromEnv(50, 200)).toBe(50);
  });
  test("clamps to max", () => {
    process.env.CRON_DAILY_LIMIT = "9999";
    expect(__test.clampLimitFromEnv(50, 200)).toBe(200);
    delete process.env.CRON_DAILY_LIMIT;
  });
  test("non-numeric returns default", () => {
    process.env.CRON_DAILY_LIMIT = "abc";
    expect(__test.clampLimitFromEnv(50, 200)).toBe(50);
    delete process.env.CRON_DAILY_LIMIT;
  });
});

describe("daily/brand-hijack-scan · cron handler", () => {
  test("rejects unauthorized", async () => {
    const res = await GET(new Request("https://x/y"));
    expect(res.status).toBe(401);
  });

  test("no businesses → OK 0 items", async () => {
    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { itemsProcessed: number };
    expect(body.itemsProcessed).toBe(0);
  });

  test("detects paid bidders + persists SerpResult", async () => {
    db.businesses.set("b1", {
      id: "b1",
      slug: "solea-spa",
      name: "Solea Spa Brickell",
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
    });
    serpOrganicMock.mockResolvedValueOnce({
      keyword: "Solea Spa Brickell",
      items: [
        {
          type: "paid",
          rank_group: 1,
          rank_absolute: 1,
          domain: "competitor.com",
          title: "Better than Solea",
          url: "https://competitor.com/spa",
        },
        {
          type: "organic",
          rank_group: 1,
          rank_absolute: 2,
          domain: "soleaspa.com",
          title: "Solea Spa · Official",
          url: "https://soleaspa.com",
        },
      ],
      operation: "dataforseo.serp.organic",
    });

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { itemsProcessed: number };
    expect(body.itemsProcessed).toBe(1);

    expect(db.serpResults).toHaveLength(1);
    const sr = db.serpResults[0];
    expect(sr.isBrandQuery).toBe(true);
    expect(sr.organicRank).toBe(1);
    const paid = sr.paidBidders as Array<{ domain: string }>;
    expect(paid).toHaveLength(1);
    expect(paid[0].domain).toBe("competitor.com");
  });

  test("upserts synthetic brand keyword once per (name, country)", async () => {
    db.businesses.set("b1", {
      id: "b1",
      slug: "spa-one",
      name: "Spa One",
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
    });
    db.businesses.set("b2", {
      id: "b2",
      slug: "spa-two",
      name: "Spa Two",
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
    });
    serpOrganicMock.mockResolvedValue({
      keyword: "x",
      items: [],
      operation: "dataforseo.serp.organic",
    });

    await GET(authedRequest());

    // Two distinct names + one country → two distinct keywords.
    expect(db.keywords.size).toBe(2);
    const k1 = Array.from(db.keywords.values()).find(
      (k) => k.keyword === "__brand:Spa One",
    );
    expect(k1).toBeDefined();
    expect(k1!.locationCode).toBe(2840);
  });

  test("adapter throws on one biz → PARTIAL run, other biz persists", async () => {
    db.businesses.set("a", {
      id: "a",
      slug: "a",
      name: "A",
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
    });
    db.businesses.set("b", {
      id: "b",
      slug: "b",
      name: "B",
      country: "US",
      isActive: true,
      lastRefreshedAt: new Date(0),
    });
    serpOrganicMock.mockImplementation(async (q: { keyword: string }) => {
      if (q.keyword === "A") throw new Error("upstream 503");
      return { keyword: q.keyword, items: [], operation: "x" };
    });

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { itemsProcessed: number };
    expect(body.itemsProcessed).toBe(1);

    const runs = Array.from(db.cronRuns.values());
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("PARTIAL");
  });
});
