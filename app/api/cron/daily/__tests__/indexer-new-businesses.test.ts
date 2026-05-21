// Integration tests for daily/indexer-new-businesses handler.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeBusiness {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
  googleCid: string | null;
  googlePlaceId: string | null;
  lastRefreshedAt: Date | null;
  firstSeenOnGoogle: Date | null;
}

const db = {
  businesses: new Map<string, FakeBusiness>(),
  cronRuns: new Map<
    string,
    {
      id: string;
      job: string;
      status: string;
      meta: Record<string, unknown> | null;
      itemsProcessed: number;
      costUsd: number;
      finishedAt: Date | null;
    }
  >(),
  nextId: 1,
  reset() {
    this.businesses.clear();
    this.cronRuns.clear();
    this.nextId = 1;
  },
};

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
    }),
  },
  default: {
    $queryRaw: vi.fn(async () => {
      // Simulate DISTINCT ON grouping: return one anchor per
      // (category, city, country) bucket. The mock returns whatever the test
      // pre-loaded.
      const seen = new Set<string>();
      const out: Array<{
        category: string;
        country: string | null;
        centroidLat: number;
        centroidLng: number;
        representativeId: string;
      }> = [];
      for (const b of db.businesses.values()) {
        if (!b.isActive || !b.lat || !b.lng || !b.category) continue;
        const k = `${b.category}|${b.city ?? ""}|${b.country ?? ""}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          category: b.category,
          country: b.country,
          centroidLat: b.lat,
          centroidLng: b.lng,
          representativeId: b.id,
        });
      }
      return out.slice(0, 25);
    }),
    business: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where:
            | {
                OR?: Array<{
                  googleCid?: string;
                  googlePlaceId?: string;
                  id?: string;
                  slug?: string;
                }>;
              }
            | { googleCid?: string; slug?: string };
        }) => {
          const conditions = "OR" in where && where.OR ? where.OR : [where];
          for (const cond of conditions) {
            for (const b of db.businesses.values()) {
              if (
                "googleCid" in cond &&
                cond.googleCid &&
                b.googleCid === cond.googleCid
              )
                return b;
              if (
                "googlePlaceId" in cond &&
                cond.googlePlaceId &&
                b.googlePlaceId === cond.googlePlaceId
              )
                return b;
              if ("slug" in cond && cond.slug && b.slug === cond.slug) return b;
            }
          }
          return null;
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        for (const b of db.businesses.values())
          if (b.slug === where.slug) return b;
        return null;
      }),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<FakeBusiness, "id"> & { slug: string };
        }) => {
          const id = `bn_${db.nextId++}`;
          const row: FakeBusiness = {
            id,
            slug: data.slug,
            name: data.name,
            category: data.category ?? null,
            city: data.city ?? null,
            country: data.country ?? null,
            lat: data.lat ?? null,
            lng: data.lng ?? null,
            isActive: true,
            googleCid: data.googleCid ?? null,
            googlePlaceId: data.googlePlaceId ?? null,
            lastRefreshedAt: null,
            firstSeenOnGoogle: data.firstSeenOnGoogle ?? null,
          };
          db.businesses.set(id, row);
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
  mapsSearch: vi.fn(),
}));

import * as svc from "@/services/dataforseo";
import {
  GET,
  mapsRowToPersist,
  slugify,
} from "../indexer-new-businesses/route";

const mapsSearchMock = svc.mapsSearch as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  db.reset();
  mapsSearchMock.mockReset();
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

describe("slugify", () => {
  test("basic", () => expect(slugify("Solea Spa")).toBe("solea-spa"));
  test("special chars stripped", () =>
    expect(slugify("Hair & Beauty, Inc!")).toBe("hair-beauty-inc"));
  test("empty / whitespace → empty", () => expect(slugify("   ")).toBe(""));
  test("truncated to 80 chars", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBe(80);
  });
});

describe("mapsRowToPersist", () => {
  test("returns null without name", () => {
    expect(mapsRowToPersist({ cid: "x" }, null)).toBeNull();
  });
  test("returns null without cid/placeId", () => {
    expect(mapsRowToPersist({ title: "X" }, null)).toBeNull();
  });
  test("happy path", () => {
    const row = mapsRowToPersist(
      {
        title: "Solea Spa",
        cid: "1234",
        place_id: "ChIJxxx",
        category: "Beauty salon",
        rating: { value: 4.8, votes_count: 312 },
        latitude: 25.767,
        longitude: -80.194,
        phone: "+13055551111",
        url: "https://soleaspa.com",
        is_claimed: true,
        address_info: { city: "Miami", region: "FL", country_code: "US" },
      },
      "US",
    );
    expect(row).not.toBeNull();
    expect(row!.name).toBe("Solea Spa");
    expect(row!.googleCid).toBe("1234");
    expect(row!.isClaimed).toBe(true);
    expect(row!.city).toBe("Miami");
    expect(row!.country).toBe("US");
    expect(row!.rating).toBe(4.8);
    expect(row!.reviewCount).toBe(312);
  });
  test("country fallback", () => {
    const row = mapsRowToPersist(
      { title: "X", cid: "c", address_info: {} },
      "CA",
    );
    expect(row!.country).toBe("CA");
  });
});

describe("daily/indexer-new-businesses · cron handler", () => {
  test("rejects unauthorized", async () => {
    const res = await GET(new Request("https://x/y"));
    expect(res.status).toBe(401);
  });

  test("no anchors → OK 0 items", async () => {
    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { itemsProcessed: number };
    expect(body.itemsProcessed).toBe(0);
  });

  test("inserts new businesses + dedupes by googleCid", async () => {
    db.businesses.set("anchor", {
      id: "anchor",
      slug: "anchor",
      name: "Anchor Spa",
      category: "Beauty salon",
      city: "Miami",
      country: "US",
      lat: 25.767,
      lng: -80.194,
      isActive: true,
      googleCid: "anchor-cid",
      googlePlaceId: null,
      lastRefreshedAt: new Date(0),
      firstSeenOnGoogle: null,
    });
    mapsSearchMock.mockResolvedValueOnce({
      items: [
        // Already-known (anchor itself)
        {
          title: "Anchor Spa",
          cid: "anchor-cid",
          category: "Beauty salon",
          latitude: 25.767,
          longitude: -80.194,
        },
        // New
        {
          title: "Brand New Spa",
          cid: "new-cid-1",
          category: "Beauty salon",
          latitude: 25.77,
          longitude: -80.19,
          address_info: { city: "Miami", region: "FL", country_code: "US" },
        },
      ],
      totalCount: 2,
      operation: "dataforseo.maps.search",
    });

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { itemsProcessed: number };
    expect(body.itemsProcessed).toBe(1);

    expect(db.businesses.size).toBe(2);
    const fresh = Array.from(db.businesses.values()).find(
      (b) => b.googleCid === "new-cid-1",
    );
    expect(fresh).toBeDefined();
    expect(fresh!.name).toBe("Brand New Spa");

    const runs = Array.from(db.cronRuns.values());
    expect(runs[0].meta?.newBusinesses).toBe(1);
    expect(runs[0].meta?.alreadyIndexed).toBe(1);
  });
});
