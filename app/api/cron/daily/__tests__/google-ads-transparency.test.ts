// Integration tests for daily/google-ads-transparency handler (stale-sweep
// placeholder · see route comment for the long-term plan).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeAd {
  id: string;
  businessId: string | null;
  platform: "META" | "GOOGLE";
  externalAdId: string;
  isActive: boolean;
  lastSeenAt: Date;
  endedAt: Date | null;
}

const db = {
  ads: new Map<string, FakeAd>(),
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
    this.ads.clear();
    this.cronRuns.clear();
    this.nextId = 1;
  },
};

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  default: {
    adLibraryEntry: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            platform: string;
            isActive: boolean;
            lastSeenAt: { lt: Date };
          };
          take: number;
        }) => {
          return Array.from(db.ads.values())
            .filter(
              (a) =>
                a.platform === where.platform &&
                a.isActive === where.isActive &&
                a.lastSeenAt < where.lastSeenAt.lt,
            )
            .slice(0, 1000)
            .map((a) => ({ id: a.id, businessId: a.businessId }));
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: { in: string[] } };
          data: Partial<FakeAd>;
        }) => {
          let count = 0;
          for (const id of where.id.in) {
            const row = db.ads.get(id);
            if (row) {
              Object.assign(row, data);
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
            status: data.status,
            costUsd: data.costUsd ?? 0,
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

import { GET, __test } from "../google-ads-transparency/route";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  db.reset();
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

describe("daily/google-ads-transparency · stale-sweep placeholder", () => {
  test("rejects unauthorized", async () => {
    const res = await GET(new Request("https://x/y"));
    expect(res.status).toBe(401);
  });

  test("no stale rows → OK 0 items", async () => {
    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; itemsProcessed: number };
    expect(body.ok).toBe(true);
    expect(body.itemsProcessed).toBe(0);
  });

  test("marks stale GOOGLE ads inactive past STALE_AFTER_MS", async () => {
    const now = Date.now();
    db.ads.set("ad_stale", {
      id: "ad_stale",
      businessId: "biz1",
      platform: "GOOGLE",
      externalAdId: "g_stale_1",
      isActive: true,
      lastSeenAt: new Date(now - __test.STALE_AFTER_MS - 24 * 60 * 60 * 1000),
      endedAt: null,
    });
    db.ads.set("ad_fresh", {
      id: "ad_fresh",
      businessId: "biz2",
      platform: "GOOGLE",
      externalAdId: "g_fresh_1",
      isActive: true,
      lastSeenAt: new Date(now - 60_000),
      endedAt: null,
    });
    db.ads.set("ad_meta_old", {
      id: "ad_meta_old",
      businessId: "biz3",
      platform: "META", // wrong platform → must not be touched
      externalAdId: "m_old_1",
      isActive: true,
      lastSeenAt: new Date(now - __test.STALE_AFTER_MS - 1),
      endedAt: null,
    });

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { itemsProcessed: number };
    expect(body.itemsProcessed).toBe(1);

    expect(db.ads.get("ad_stale")!.isActive).toBe(false);
    expect(db.ads.get("ad_stale")!.endedAt).not.toBeNull();
    expect(db.ads.get("ad_fresh")!.isActive).toBe(true);
    expect(db.ads.get("ad_meta_old")!.isActive).toBe(true);

    const runs = Array.from(db.cronRuns.values());
    expect(runs[0].status).toBe("OK");
    expect(runs[0].meta?.staleMarked).toBe(1);
  });
});
