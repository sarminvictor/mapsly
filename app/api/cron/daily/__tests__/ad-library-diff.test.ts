// Integration tests for daily/ad-library-diff handler.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeBusiness {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  isActive: boolean;
  isClaimed: boolean;
  lastRefreshedAt: Date | null;
}
interface FakeAd {
  id: string;
  businessId: string | null;
  platform: "META" | "GOOGLE" | "TIKTOK";
  externalAdId: string;
  isActive: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  endedAt: Date | null;
}
interface FakeCronRun {
  id: string;
  job: string;
  status: string;
  costUsd: number;
  finishedAt: Date | null;
  itemsProcessed: number;
  meta: Record<string, unknown> | null;
}

const db = {
  businesses: new Map<string, FakeBusiness>(),
  ads: new Map<string, FakeAd>(),
  cronRuns: new Map<string, FakeCronRun>(),
  nextId: 1,
  reset() {
    this.businesses.clear();
    this.ads.clear();
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
    adLibraryEntry: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { businessId: string; platform: "META" };
          select: unknown;
        }) => {
          return Array.from(db.ads.values())
            .filter(
              (a) =>
                a.platform === where.platform &&
                a.businessId === where.businessId,
            )
            .map((a) => ({
              externalAdId: a.externalAdId,
              isActive: a.isActive,
            }));
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Partial<FakeAd> & { externalAdId: string };
        }) => {
          const id = `ad_${db.nextId++}`;
          const row: FakeAd = {
            id,
            businessId: data.businessId ?? null,
            platform: (data.platform ?? "META") as FakeAd["platform"],
            externalAdId: data.externalAdId,
            isActive: data.isActive ?? true,
            firstSeenAt: data.firstSeenAt ?? new Date(),
            lastSeenAt: data.lastSeenAt ?? new Date(),
            endedAt: data.endedAt ?? null,
          };
          db.ads.set(id, row);
          return row;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { externalAdId: string };
          data: Partial<FakeAd>;
        }) => {
          const row = Array.from(db.ads.values()).find(
            (a) => a.externalAdId === where.externalAdId,
          );
          if (!row) throw new Error("not found");
          Object.assign(row, data);
          return row;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { externalAdId: { in: string[] } };
          data: Partial<FakeAd>;
        }) => {
          let count = 0;
          for (const a of db.ads.values()) {
            if (where.externalAdId.in.includes(a.externalAdId)) {
              Object.assign(a, data);
              count += 1;
            }
          }
          return { count };
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

vi.mock("@/services/meta-ad-library", () => ({
  adsArchiveSearch: vi.fn(),
  parseBand: vi.fn(
    (
      band: { lower_bound?: string; upper_bound?: string } | undefined,
    ): { mid: number; low: number; high: number } | null => {
      if (!band) return null;
      const parseOne = (raw: string | undefined): number | null => {
        if (raw == null) return null;
        const n = Number(String(raw).trim());
        return Number.isFinite(n) ? n : null;
      };
      const low = parseOne(band.lower_bound);
      const high = parseOne(band.upper_bound);
      if (low === null && high === null) return null;
      if (low !== null && high !== null) {
        return { mid: (low + high) / 2, low, high };
      }
      const single = (low ?? high) as number;
      return { mid: single, low: single, high: single };
    },
  ),
}));

import * as svc from "@/services/meta-ad-library";
import { GET, __test } from "../ad-library-diff/route";

const adsArchiveMock = svc.adsArchiveSearch as unknown as ReturnType<
  typeof vi.fn
>;

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  db.reset();
  adsArchiveMock.mockReset();
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

describe("adRowToPersist", () => {
  test("happy path", () => {
    const row = __test.adRowToPersist(
      {
        id: "ad1",
        ad_creative_bodies: ["Half off!"],
        ad_creative_link_captions: ["https://landing.example.com"],
        ad_delivery_start_time: "2026-05-01T00:00:00+0000",
        ad_delivery_stop_time: "2026-05-15T00:00:00+0000",
        impressions: { lower_bound: "1000", upper_bound: "5000" },
        spend: { lower_bound: "100", upper_bound: "499" },
      },
      "biz1",
    );
    expect(row.adCreativeBody).toBe("Half off!");
    expect(row.landingUrl).toBe("https://landing.example.com");
    expect(row.impressionsMid).toBe(3000);
    expect(row.spendMidLow).toBe(100);
    expect(row.spendMidHigh).toBe(499);
    expect(row.platform).toBe("META");
  });

  test("missing fields → nulls (not crashes)", () => {
    const row = __test.adRowToPersist({ id: "ad2" }, "biz1");
    expect(row.adCreativeBody).toBeNull();
    expect(row.landingUrl).toBeNull();
    expect(row.startedAt).toBeNull();
    expect(row.endedAt).toBeNull();
    expect(row.impressionsMid).toBeNull();
    expect(row.spendMidLow).toBeNull();
  });
});

describe("daily/ad-library-diff · cron handler", () => {
  test("rejects unauthorized", async () => {
    const res = await GET(new Request("https://x/y"));
    expect(res.status).toBe(401);
  });

  test("no businesses → OK 0 items", async () => {
    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
  });

  test("inserts new + bumps known + ends stale ads", async () => {
    db.businesses.set("b1", {
      id: "b1",
      slug: "biz1",
      name: "Biz One",
      country: "US",
      isActive: true,
      isClaimed: true,
      lastRefreshedAt: new Date(0),
    });

    // Pre-existing ad we DO see this run + one we DON'T.
    db.ads.set("ad_pre_kept", {
      id: "ad_pre_kept",
      businessId: "b1",
      platform: "META",
      externalAdId: "meta_keep",
      isActive: true,
      firstSeenAt: new Date(0),
      lastSeenAt: new Date(0),
      endedAt: null,
    });
    db.ads.set("ad_pre_stale", {
      id: "ad_pre_stale",
      businessId: "b1",
      platform: "META",
      externalAdId: "meta_stale",
      isActive: true,
      firstSeenAt: new Date(0),
      lastSeenAt: new Date(0),
      endedAt: null,
    });

    adsArchiveMock.mockResolvedValueOnce({
      rows: [
        { id: "meta_keep", ad_creative_bodies: ["heartbeat"] },
        { id: "meta_new", ad_creative_bodies: ["fresh"] },
      ],
      totalFetched: 2,
      truncated: false,
      operation: "meta.ads_archive",
    });

    await GET(authedRequest());

    // ad_pre_kept should be bumped, still active
    const kept = db.ads.get("ad_pre_kept");
    expect(kept?.isActive).toBe(true);
    expect(kept?.lastSeenAt.getTime()).toBeGreaterThan(0);

    // ad_pre_stale should be ended
    const stale = db.ads.get("ad_pre_stale");
    expect(stale?.isActive).toBe(false);
    expect(stale?.endedAt).not.toBeNull();

    // New ad should be inserted
    const all = Array.from(db.ads.values());
    const newOne = all.find((a) => a.externalAdId === "meta_new");
    expect(newOne).toBeDefined();
    expect(newOne?.isActive).toBe(true);

    // Run should be OK
    const runs = Array.from(db.cronRuns.values());
    expect(runs[0].status).toBe("OK");
    expect(runs[0].meta?.newAds).toBe(1);
    expect(runs[0].meta?.endedAds).toBe(1);
    expect(runs[0].meta?.bumpedAds).toBe(1);
  });

  test("re-activates a previously-ended ad if it reappears", async () => {
    db.businesses.set("b1", {
      id: "b1",
      slug: "biz1",
      name: "Biz One",
      country: "US",
      isActive: true,
      isClaimed: false,
      lastRefreshedAt: new Date(0),
    });
    db.ads.set("ad_revival", {
      id: "ad_revival",
      businessId: "b1",
      platform: "META",
      externalAdId: "meta_revived",
      isActive: false,
      firstSeenAt: new Date(0),
      lastSeenAt: new Date(0),
      endedAt: new Date(0),
    });
    adsArchiveMock.mockResolvedValueOnce({
      rows: [{ id: "meta_revived" }],
      totalFetched: 1,
      truncated: false,
      operation: "meta.ads_archive",
    });

    await GET(authedRequest());

    const revived = db.ads.get("ad_revival");
    expect(revived?.isActive).toBe(true);
    expect(revived?.endedAt).toBeNull();
  });
});
