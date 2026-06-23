// Tests for runMetaAdsForCell · the three required invariants:
//   1. freshness gate returns served-from-db when a run is ≤30d old,
//   2. a stale cell triggers the Apify adapter + persists an AdMarketRun,
//   3. an ad is attributed to a business by exact pageId match.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MetaAdRow } from "@/services/apify";

// ---- prisma mock --------------------------------------------------------
// A minimal in-memory stand-in. Each method captures its calls so assertions
// can inspect what was persisted.
const db = vi.hoisted(() => {
  const adMarketRunRows: Array<Record<string, unknown>> = [];
  const adLibraryEntryUpserts: Array<Record<string, unknown>> = [];
  const adMarketAdvertiserUpserts: Array<Record<string, unknown>> = [];
  let latestRun: { id: string; ranAt: Date; status: string } | null = null;
  return {
    adMarketRunRows,
    adLibraryEntryUpserts,
    adMarketAdvertiserUpserts,
    setLatestRun(r: { id: string; ranAt: Date; status: string } | null) {
      latestRun = r;
    },
    getLatestRun() {
      return latestRun;
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    adMarketRun: {
      findFirst: vi.fn(async () => db.getLatestRun()),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.adMarketRunRows.push(data);
        return { id: `run_${db.adMarketRunRows.length}`, ...data };
      }),
    },
    adLibraryEntry: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        db.adLibraryEntryUpserts.push(args);
        return { id: `entry_${db.adLibraryEntryUpserts.length}` };
      }),
    },
    adMarketAdvertiser: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        db.adMarketAdvertiserUpserts.push(args);
        return { id: `adv_${db.adMarketAdvertiserUpserts.length}` };
      }),
    },
  },
  Prisma: {},
}));

// ---- service adapter mock ----------------------------------------------
const apify = vi.hoisted(() => ({ metaAdLibrarySearch: vi.fn() }));
vi.mock("@/services/apify", () => ({
  metaAdLibrarySearch: apify.metaAdLibrarySearch,
}));

// ---- cell-context mock (deps are pure infra · not under test here) -------
const ctx = vi.hoisted(() => ({ resolveCellContext: vi.fn() }));
vi.mock("../cell-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cell-context")>();
  return { ...actual, resolveCellContext: ctx.resolveCellContext };
});

import { runMetaAdsForCell } from "../meta-ads";

const CELL = "medical_spa|miami|US";
const NOW = new Date("2026-06-22T12:00:00.000Z");

function adRow(over: Partial<MetaAdRow>): MetaAdRow {
  return {
    id: "ad1",
    pageId: "PAGE_X",
    pageName: "Some Page",
    adCreativeBody: "Botox special",
    linkTitle: null,
    linkCaption: null,
    linkDescription: null,
    linkUrl: null,
    ctaText: null,
    displayFormat: "image",
    imageUrl: null,
    videoUrl: null,
    snapshotUrl: null,
    platforms: ["FACEBOOK", "INSTAGRAM"],
    startDate: "2026-01-01",
    endDate: null,
    isActive: true,
    collationCount: 2,
    searchTerm: "botox miami",
    pageQuery: null,
    resolvedFromUrl: null,
    country: "US",
    scrapedAt: null,
    ...over,
  };
}

function fakeCtx(businesses: Array<Record<string, unknown>>) {
  return {
    cellKey: CELL,
    categorySlug: "medical_spa",
    metroSlug: "miami",
    country: "US",
    metro: { slug: "miami", name: "Miami, FL", lat: 25.76, lng: -80.19 },
    cityLabel: "Miami",
    locationCode: 2840,
    locationCoordinate: "25.76,-80.19,30",
    businesses,
  };
}

beforeEach(() => {
  db.adMarketRunRows.length = 0;
  db.adLibraryEntryUpserts.length = 0;
  db.adMarketAdvertiserUpserts.length = 0;
  db.setLatestRun(null);
  apify.metaAdLibrarySearch.mockReset();
  ctx.resolveCellContext.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("runMetaAdsForCell · freshness gate", () => {
  test("returns served-from-db when a run is ≤30d old · no adapter call", async () => {
    db.setLatestRun({
      id: "r1",
      ranAt: new Date(NOW.getTime() - 5 * 86_400_000),
      status: "OK",
    });
    const res = await runMetaAdsForCell(CELL, NOW);
    expect(res.outcome).toBe("served-from-db");
    expect(apify.metaAdLibrarySearch).not.toHaveBeenCalled();
    expect(db.adMarketRunRows).toHaveLength(0);
  });
});

describe("runMetaAdsForCell · stale cell", () => {
  test("triggers the adapter + persists an AdMarketRun(META)", async () => {
    db.setLatestRun({
      id: "old",
      ranAt: new Date(NOW.getTime() - 40 * 86_400_000),
      status: "OK",
    });
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [adRow({ id: "adA", pageId: "COMP_1", pageName: "Rival Spa" })],
      resolutions: [],
      runId: "apify-run-1",
      usageTotalUsd: 0.04,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    expect(apify.metaAdLibrarySearch).toHaveBeenCalledTimes(1);
    expect(res.outcome).toBe("collected");
    expect(res.costUsd).toBe(0.04);
    // exactly one AdMarketRun(META) telemetry row written
    const runs = db.adMarketRunRows.filter((r) => r.platform === "META");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ cellKey: CELL, platform: "META" });
    // competitor advertiser captured in AdMarketAdvertiser
    expect(db.adMarketAdvertiserUpserts).toHaveLength(1);
  });

  test("never-run cell (latest=null) is stale and collects", async () => {
    db.setLatestRun(null);
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      resolutions: [],
      runId: "r",
      usageTotalUsd: 0.01,
    });
    const res = await runMetaAdsForCell(CELL, NOW);
    expect(res.outcome).toBe("collected");
    expect(apify.metaAdLibrarySearch).toHaveBeenCalledTimes(1);
  });
});

describe("runMetaAdsForCell · attribution", () => {
  test("attributes an ad to a business by exact pageId match", async () => {
    db.setLatestRun(null);
    ctx.resolveCellContext.mockResolvedValueOnce(
      fakeCtx([
        {
          id: "biz-maria",
          name: "Solea Brickell Spa",
          slug: "solea-brickell",
          domain: "soleabrickell.com",
          website: null,
          fbPageId: "PAGE_MARIA",
        },
      ]),
    );
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [
        adRow({ id: "ad-maria", pageId: "PAGE_MARIA", pageName: "Solea" }),
        adRow({ id: "ad-comp", pageId: "OTHER", pageName: "Other Clinic" }),
      ],
      resolutions: [],
      runId: "r",
      usageTotalUsd: 0.03,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    // Only the pageId-matched ad becomes a per-business AdLibraryEntry.
    expect(db.adLibraryEntryUpserts).toHaveLength(1);
    const entry = db.adLibraryEntryUpserts[0] as {
      where: { externalAdId: string };
      create: { businessId: string; pageId: string };
    };
    expect(entry.where.externalAdId).toBe("ad-maria");
    expect(entry.create.businessId).toBe("biz-maria");
    expect(entry.create.pageId).toBe("PAGE_MARIA");
    expect(res.adCount).toBe(1);
  });
});
