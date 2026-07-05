// Regression for the advertiser-FACET ingestion path in collectCellMeta.
//
// Meta withholds the per-creative results GraphQL from automated sessions, so a
// keyword cell search now returns `advertisers` (the facet) and usually NO
// creative `rows`. This test proves the facet alone produces AdMarketAdvertiser
// upserts, the name-matching advertiser is linked to our seeded business, and
// advertisers active before but absent now are reconciled inactive.
//
// Prisma is mocked with the same vi.hoisted in-memory pattern the cell-intel
// meta-ads test uses; the Apify adapter is mocked so no paid run fires.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MetaAdvertiser } from "@/services/apify";

// ---- prisma mock --------------------------------------------------------
const db = vi.hoisted(() => {
  const advertiserUpserts: Array<Record<string, unknown>> = [];
  const businessUpdates: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];
  // Seeded cell businesses returned by business.findMany.
  let businesses: Array<{ id: string; name: string; fbPageId: string | null }> =
    [];
  // Services returned by businessService.findMany.
  let services: Array<{ name: string }> = [];
  return {
    advertiserUpserts,
    businessUpdates,
    updateManyCalls,
    setBusinesses(
      b: Array<{ id: string; name: string; fbPageId: string | null }>,
    ) {
      businesses = b;
    },
    getBusinesses() {
      return businesses;
    },
    setServices(s: Array<{ name: string }>) {
      services = s;
    },
    getServices() {
      return services;
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    businessService: {
      findMany: vi.fn(async () => db.getServices()),
    },
    business: {
      findMany: vi.fn(async () => db.getBusinesses()),
      update: vi.fn(async (args: Record<string, unknown>) => {
        db.businessUpdates.push(args);
        return { id: "x" };
      }),
    },
    adMarketAdvertiser: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        db.advertiserUpserts.push(args);
        return { id: `adv_${db.advertiserUpserts.length}` };
      }),
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        db.updateManyCalls.push(args);
        return { count: 0 };
      }),
    },
    adMarketInsight: {
      upsert: vi.fn(async () => ({ id: "ins_1" })),
    },
  },
  Prisma: {},
}));

// ---- service adapter mock ----------------------------------------------
const apify = vi.hoisted(() => ({ metaAdLibrarySearch: vi.fn() }));
vi.mock("@/services/apify", () => ({
  metaAdLibrarySearch: apify.metaAdLibrarySearch,
}));

// ---- AI mock (must never be called on an advertiser-only run) ------------
const ai = vi.hoisted(() => ({ analyzeAdCreatives: vi.fn() }));
vi.mock("@/services/ai", () => ({
  analyzeAdCreatives: ai.analyzeAdCreatives,
  DEFAULT_AD_INSIGHTS_MODEL: "gpt-test",
  MIN_CREATIVES_TO_ANALYZE: 4,
}));

import { collectCellMeta, type CellRef } from "../collect-cell-meta";

function advertiser(over: Partial<MetaAdvertiser>): MetaAdvertiser {
  return {
    recordType: "advertiser",
    pageId: "PID",
    pageName: "Some Advertiser",
    adCount: 3,
    searchTerm: "dentist san francisco",
    country: "US",
    ...over,
  };
}

const CELL: CellRef = {
  category: "Dentist",
  city: "San Francisco",
  country: "US",
  businessIds: ["biz-1", "biz-2"],
};

beforeEach(() => {
  db.advertiserUpserts.length = 0;
  db.businessUpdates.length = 0;
  db.updateManyCalls.length = 0;
  db.setBusinesses([
    { id: "biz-1", name: "Bright Smile Dental SF", fbPageId: null },
    { id: "biz-2", name: "Marina Family Dentistry", fbPageId: null },
  ]);
  db.setServices([{ name: "cleaning" }, { name: "implants" }]);
  apify.metaAdLibrarySearch.mockReset();
  ai.analyzeAdCreatives.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("collectCellMeta · advertiser facet ingestion", () => {
  test("upserts an AdMarketAdvertiser per facet advertiser (no creatives)", async () => {
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      resolutions: [],
      advertisers: [
        advertiser({
          pageId: "P_BRIGHT",
          pageName: "Bright Smile Dental",
          adCount: 7,
        }),
        advertiser({ pageId: "P_NOISE", pageName: "SFGATE", adCount: 99 }),
      ],
      runId: "run-1",
      usageTotalUsd: 0.052,
    });

    const res = await collectCellMeta(CELL, { ai: false });

    expect(apify.metaAdLibrarySearch).toHaveBeenCalledTimes(1);
    expect(res.advertisers).toBe(2);
    expect(res.creatives).toBe(0);
    expect(res.runUsd).toBeCloseTo(0.052, 6);
    expect(db.advertiserUpserts).toHaveLength(2);

    // activeAdCount comes from the facet adCount when there are no creatives.
    const byPid = new Map(
      db.advertiserUpserts.map((u) => {
        const a = u as {
          where: {
            category_city_country_platform_pageId: { pageId: string };
          };
          create: { activeAdCount: number; matchedBusinessId: string | null };
        };
        return [a.where.category_city_country_platform_pageId.pageId, a.create];
      }),
    );
    expect(byPid.get("P_BRIGHT")?.activeAdCount).toBe(7);
    expect(byPid.get("P_NOISE")?.activeAdCount).toBe(99);
  });

  test("links the name-matching advertiser to our seeded business", async () => {
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      resolutions: [],
      advertisers: [
        // "Bright Smile Dental" shares the distinctive token "bright"/"smile"
        // with "Bright Smile Dental SF" → matched.
        advertiser({ pageId: "P_BRIGHT", pageName: "Bright Smile Dental" }),
        // Industry-noise page (returned by the keyword search) matches no
        // indexed dentist → upserted as a market advertiser, but unmatched.
        advertiser({ pageId: "P_NOISE", pageName: "Church of Scientology" }),
      ],
      runId: "run-2",
      usageTotalUsd: 0.01,
    });

    await collectCellMeta(CELL, { ai: false });

    const create = (pid: string) =>
      (
        db.advertiserUpserts.find((u) => {
          const a = u as {
            where: {
              category_city_country_platform_pageId: { pageId: string };
            };
          };
          return a.where.category_city_country_platform_pageId.pageId === pid;
        }) as { create: { matchedBusinessId: string | null } } | undefined
      )?.create;

    expect(create("P_BRIGHT")?.matchedBusinessId).toBe("biz-1");
    expect(create("P_NOISE")?.matchedBusinessId).toBeNull();

    // The matched page id is cached back onto the business (was null before).
    expect(db.businessUpdates).toHaveLength(1);
    const upd = db.businessUpdates[0] as {
      where: { id: string };
      data: { fbPageId: string };
    };
    expect(upd.where.id).toBe("biz-1");
    expect(upd.data.fbPageId).toBe("P_BRIGHT");

    // AI is skipped on an advertiser-only run (no creatives to analyze).
    expect(ai.analyzeAdCreatives).not.toHaveBeenCalled();
  });

  test("reconciles prior-active advertisers absent this run → inactive", async () => {
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      resolutions: [],
      advertisers: [
        advertiser({ pageId: "P_BRIGHT", pageName: "Bright Smile Dental" }),
      ],
      runId: "run-3",
      usageTotalUsd: 0.01,
    });

    await collectCellMeta(CELL, { ai: false });

    expect(db.updateManyCalls).toHaveLength(1);
    const call = db.updateManyCalls[0] as {
      where: {
        platform: string;
        isActive: boolean;
        pageId: { notIn: string[] };
      };
      data: { isActive: boolean };
    };
    expect(call.where.platform).toBe("META");
    expect(call.where.isActive).toBe(true);
    // Only the page seen this run is excluded from the inactivation sweep.
    expect(call.where.pageId.notIn).toEqual(["P_BRIGHT"]);
    expect(call.data.isActive).toBe(false);
  });

  test("a blocked run bails before persisting (no false empty overwrite)", async () => {
    // The run never reached Meta's data query. It must NOT overwrite the cell's
    // advertisers with an empty result (which the inactivation sweep would then
    // read as "everyone stopped advertising"). Bail with an error, persist
    // nothing.
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      resolutions: [],
      advertisers: [],
      outcome: "blocked",
      runStatus: "FAILED",
      targetStatuses: [],
      runId: "blocked-run",
      usageTotalUsd: 0.02,
    });

    const res = await collectCellMeta(CELL, { ai: false });

    expect(res.errors).toContain("cell-meta-outcome:blocked");
    expect(db.advertiserUpserts).toHaveLength(0);
    expect(db.updateManyCalls).toHaveLength(0);
  });
});
