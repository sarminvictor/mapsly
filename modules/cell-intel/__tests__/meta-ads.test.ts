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
  const businessUpdateManyCalls: Array<Record<string, unknown>> = [];
  let contactRows: Array<{
    businessId: string;
    value: string;
    channel: string;
  }> = [];
  let latestRun: { id: string; ranAt: Date; status: string } | null = null;
  return {
    adMarketRunRows,
    adLibraryEntryUpserts,
    adMarketAdvertiserUpserts,
    businessUpdateManyCalls,
    setContacts(rows: Array<{ businessId: string; value: string }>) {
      contactRows = rows.map((r) => ({ ...r, channel: "FACEBOOK" }));
    },
    getContacts() {
      return contactRows;
    },
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
    contact: {
      findMany: vi.fn(async () => db.getContacts()),
    },
    business: {
      updateMany: vi.fn(async (args: Record<string, unknown>) => {
        db.businessUpdateManyCalls.push(args);
        return { count: 1 };
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

// ---- R2 breaker mock (degrade-open by default; toggle for the OPEN test) --
const breaker = vi.hoisted(() => ({
  shouldRunMetaCell: vi.fn(async () => ({ allow: true, reason: "closed" })),
  recordMetaCellOutcome: vi.fn(async () => {}),
}));
vi.mock("@/lib/cost/meta-block-breaker", () => ({
  shouldRunMetaCell: breaker.shouldRunMetaCell,
  recordMetaCellOutcome: breaker.recordMetaCellOutcome,
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
  db.businessUpdateManyCalls.length = 0;
  db.setContacts([]);
  db.setLatestRun(null);
  apify.metaAdLibrarySearch.mockReset();
  ctx.resolveCellContext.mockReset();
  breaker.shouldRunMetaCell.mockReset();
  breaker.shouldRunMetaCell.mockResolvedValue({
    allow: true,
    reason: "closed",
  });
  breaker.recordMetaCellOutcome.mockReset();
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
      advertisers: [],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
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
      advertisers: [],
      outcome: "empty_verified",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
      runId: "r",
      usageTotalUsd: 0.01,
    });
    const res = await runMetaAdsForCell(CELL, NOW);
    expect(res.outcome).toBe("collected");
    expect(apify.metaAdLibrarySearch).toHaveBeenCalledTimes(1);
  });

  test("consumes the advertiser FACET even with zero creative rows", async () => {
    // Meta withholds per-creative results from automated sessions — the actor
    // returns the advertiser facet (who advertises + ad count) and 0 rows. The
    // cell run MUST record those advertisers (the "meta_ads always 0" bug was
    // consuming rows but dropping `advertisers`).
    db.setLatestRun(null);
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      advertisers: [
        { pageId: "PG1", pageName: "The Gentle Crumb", adCount: 3 },
        { pageId: "PG2", pageName: "Gluten Free Journey", adCount: 1 },
      ],
      resolutions: [],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
      runId: "facet-run",
      usageTotalUsd: 0.02,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    expect(res.outcome).toBe("collected");
    expect(res.advertiserCount).toBe(2);
    expect(db.adMarketAdvertiserUpserts).toHaveLength(2);
    // the facet ad count carries onto the advertiser aggregate
    const names = db.adMarketAdvertiserUpserts.map(
      (u) => (u.create as { pageName?: string })?.pageName,
    );
    expect(names).toContain("The Gentle Crumb");
    expect(names).toContain("Gluten Free Journey");
  });

  test("R2 · circuit breaker OPEN defers the run without burning proxy $", async () => {
    // Meta is block-storming → the breaker is OPEN. The cell must be DEFERRED:
    // no adapter call, no AdMarketRun row (so the cell stays retryable, the
    // 30-day gate is untouched), and a breaker reason recorded.
    db.setLatestRun(null);
    breaker.shouldRunMetaCell.mockResolvedValueOnce({
      allow: false,
      reason: "open-cooldown",
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    expect(res.outcome).toBe("deferred");
    expect(res.errors).toContain("meta-breaker:open-cooldown");
    expect(apify.metaAdLibrarySearch).not.toHaveBeenCalled();
    // No AdMarketRun written → freshness gate + dead-letter query untouched.
    expect(db.adMarketRunRows).toHaveLength(0);
    // Cell context is never resolved on a deferred run.
    expect(ctx.resolveCellContext).not.toHaveBeenCalled();
  });

  test("a blocked run records AdMarketRun FAILED (retryable), not OK/0", async () => {
    // The run never reached Meta's data query (soft-block). It must NOT be
    // recorded as a verified empty — that would lock the 30-day freshness gate
    // on a false 0 and poison the coverage matrix. Record FAILED + persist
    // nothing.
    db.setLatestRun(null);
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      advertisers: [],
      resolutions: [],
      outcome: "blocked",
      runStatus: "FAILED",
      targetStatuses: [],
      runId: "blocked-run",
      usageTotalUsd: 0.03,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    expect(res.errors).toContain("meta-outcome:blocked");
    const runs = db.adMarketRunRows.filter((r) => r.platform === "META");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("FAILED");
    // No advertisers persisted on a blocked run.
    expect(db.adMarketAdvertiserUpserts).toHaveLength(0);
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
      advertisers: [],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
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

  test("seeds fbPageId from a resolution + reliably attributes the resolved ad", async () => {
    // A business with NO stored fbPageId but a Facebook contact. The actor
    // resolves its page URL → pageId (a `resolution` record). That id MUST (a)
    // be persisted to Business.fbPageId (updateMany, null-guarded) and (b) make
    // the run's ad on that pageId attribute to the business even though nothing
    // was stored before the run.
    db.setLatestRun(null);
    db.setContacts([
      { businessId: "biz-maria", value: "https://facebook.com/soleabrickell" },
    ]);
    ctx.resolveCellContext.mockResolvedValueOnce(
      fakeCtx([
        {
          id: "biz-maria",
          name: "Solea Brickell Spa",
          slug: "solea-brickell",
          domain: "soleabrickell.com",
          website: "https://soleabrickell.com",
          fbPageId: null, // not yet resolved — the whole point of the seed
        },
      ]),
    );
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [adRow({ id: "ad-maria", pageId: "PAGE_RESOLVED" })],
      resolutions: [
        {
          resolvedFromUrl: "https://facebook.com/soleabrickell",
          pageId: "PAGE_RESOLVED",
        },
      ],
      advertisers: [],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
      runId: "r-seed",
      usageTotalUsd: 0.04,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    // fbPageId seeded on the business (null-guarded updateMany).
    expect(res.fbPageIdsSeeded).toBe(1);
    expect(db.businessUpdateManyCalls).toHaveLength(1);
    const upd = db.businessUpdateManyCalls[0] as {
      where: { id: string; fbPageId: null };
      data: { fbPageId: string };
    };
    expect(upd.where).toMatchObject({ id: "biz-maria", fbPageId: null });
    expect(upd.data.fbPageId).toBe("PAGE_RESOLVED");

    // The ad on the newly-resolved pageId attributes reliably to the business.
    expect(db.adLibraryEntryUpserts).toHaveLength(1);
    const entry = db.adLibraryEntryUpserts[0] as {
      create: { businessId: string; pageId: string };
    };
    expect(entry.create.businessId).toBe("biz-maria");
    expect(entry.create.pageId).toBe("PAGE_RESOLVED");
  });

  test("writes a facet-derived AdLibraryEntry for a matched advertiser with 0 creative rows", async () => {
    // Meta withheld the per-creative rows (the common keyword-scan case) but the
    // facet says this business's page advertises. With a stored fbPageId, the
    // facet advertiser matches → a minimal placeholder AdLibraryEntry is written
    // so has_active_meta_ads / meta_ad_count / not_advertising fire correctly.
    db.setLatestRun(null);
    ctx.resolveCellContext.mockResolvedValueOnce(
      fakeCtx([
        {
          id: "biz-maria",
          name: "Solea Brickell Spa",
          slug: "solea-brickell",
          domain: "soleabrickell.com",
          website: null,
          fbPageId: "PAGE_MARIA", // already resolved → matches the facet pageId
        },
      ]),
    );
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [], // Meta withheld per-creative results
      advertisers: [
        { pageId: "PAGE_MARIA", pageName: "Solea Brickell Spa", adCount: 5 },
        { pageId: "COMP_ONLY", pageName: "Rival Clinic", adCount: 2 },
      ],
      resolutions: [],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
      runId: "r-facet",
      usageTotalUsd: 0.02,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    // Exactly ONE facet-derived per-business AdLibraryEntry — the competitor
    // (COMP_ONLY, unmatched) stays in the market layer only.
    expect(db.adLibraryEntryUpserts).toHaveLength(1);
    const entry = db.adLibraryEntryUpserts[0] as {
      where: { externalAdId: string };
      create: {
        businessId: string;
        pageId: string;
        isActive: boolean;
        collationCount: number | null;
      };
    };
    expect(entry.where.externalAdId).toBe("meta-facet:PAGE_MARIA");
    expect(entry.create.businessId).toBe("biz-maria");
    expect(entry.create.pageId).toBe("PAGE_MARIA");
    expect(entry.create.isActive).toBe(true);
    expect(entry.create.collationCount).toBe(5); // facet ad count carried
    expect(res.entriesUpserted).toBe(1);
    // Both advertisers still recorded in the market layer (AdMarketAdvertiser).
    expect(db.adMarketAdvertiserUpserts).toHaveLength(2);
  });

  test("facet fallback does NOT double-write when a real per-ad row already exists", async () => {
    // Same business returns BOTH a real creative row AND a facet entry for its
    // page. Only the real per-ad AdLibraryEntry is written — the facet
    // placeholder is skipped so rollupAds.activeCount isn't inflated.
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
      rows: [adRow({ id: "ad-real", pageId: "PAGE_MARIA" })],
      advertisers: [
        { pageId: "PAGE_MARIA", pageName: "Solea Brickell Spa", adCount: 5 },
      ],
      resolutions: [],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
      runId: "r-both",
      usageTotalUsd: 0.03,
    });

    await runMetaAdsForCell(CELL, NOW);

    // Exactly one entry — the real ad, not a duplicate facet placeholder.
    expect(db.adLibraryEntryUpserts).toHaveLength(1);
    const ids = db.adLibraryEntryUpserts.map(
      (u) => (u.where as { externalAdId: string }).externalAdId,
    );
    expect(ids).toEqual(["ad-real"]);
    expect(ids).not.toContain("meta-facet:PAGE_MARIA");
  });
});
