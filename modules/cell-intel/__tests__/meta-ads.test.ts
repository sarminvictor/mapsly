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
  // `advertiserCount` rides along for the A4 soft-block heuristic's
  // known-advertiser-cell read (the mock's findFirst serves BOTH the freshness
  // gate and that query — where-clauses are not interpreted).
  let latestRun: {
    id: string;
    ranAt: Date;
    status: string;
    advertiserCount?: number;
  } | null = null;
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
    setLatestRun(
      r: {
        id: string;
        ranAt: Date;
        status: string;
        advertiserCount?: number;
      } | null,
    ) {
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

  test("facet-first · a facet advertiser NAME-MATCHED to a cell business seeds its fbPageId (step 4c)", async () => {
    // 2026-07-10 · facet-first replaces the per-business pageUrl HTTP resolve
    // (which Meta blocks → FAILED prod runs). The facet carries each advertiser's
    // pageId + name, so a cell business is attributed + its fbPageId seeded by
    // NAME-matching the facet — no HTTP, no page targets.
    db.setLatestRun(null);
    ctx.resolveCellContext.mockResolvedValueOnce(
      fakeCtx([
        {
          id: "biz-1",
          name: "Solea Brickell Spa",
          website: "https://solea.example",
          fbPageId: null,
        },
      ]),
    );
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      advertisers: [
        {
          recordType: "advertiser",
          pageId: "PAGE_9",
          pageName: "Solea Brickell Spa",
          adCount: 3,
          searchTerm: "medical spa Miami",
          country: "US",
        },
      ],
      resolutions: [],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
      runId: "facet-run",
      usageTotalUsd: 0.05,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    // The business's fbPageId was seeded FROM the facet advertiser's pageId…
    expect(res.fbPageIdsSeeded).toBe(1);
    const seed = db.businessUpdateManyCalls.find(
      (c) =>
        (c.data as Record<string, unknown> | undefined)?.fbPageId === "PAGE_9",
    );
    expect(seed).toBeDefined();
    // …guarded so a hand-corrected id is never clobbered.
    expect((seed!.where as Record<string, unknown>).fbPageId).toBeNull();
  });
});

describe("runMetaAdsForCell · A4 soft-block suspicion (0 advertisers)", () => {
  test("0 rows + prior-advertiser cell → FAILED (freshness gate retries)", async () => {
    // The cell verifiably HAD advertisers on a prior successful run (>30d ago,
    // or the gate would have served it). A sudden clean-looking 0 is a
    // suspected soft-block — write FAILED so the next purchase retries instead
    // of serving cached emptiness for 30 days.
    db.setLatestRun({
      id: "old-ok",
      ranAt: new Date(NOW.getTime() - 40 * 86_400_000),
      status: "OK",
      advertiserCount: 7,
    });
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      advertisers: [],
      resolutions: [],
      outcome: "empty_verified",
      runStatus: "SUCCEEDED",
      targetStatuses: [
        {
          recordType: "target_status",
          subject: "medical spa Miami",
          label: "search",
          status: "empty_verified",
          graphqlHits: 1,
        },
      ],
      runId: "sus-run",
      usageTotalUsd: 0.02,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    expect(res.outcome).toBe("collected"); // billing/flow unchanged
    const runs = db.adMarketRunRows.filter((r) => r.platform === "META");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("FAILED");
    expect(
      res.errors.some((e) => e.startsWith("meta-softblock-suspected:")),
    ).toBe(true);
    expect(res.errors.join(" ")).toContain("prior-advertisers-7");
  });

  test("0 rows with NO verified target status → FAILED (no evidence the data query fired)", async () => {
    db.setLatestRun(null); // no prior run at all
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      advertisers: [],
      resolutions: [],
      outcome: "empty_verified", // inferred fallback — evidence-less
      runStatus: "SUCCEEDED",
      targetStatuses: [],
      runId: "no-evidence-run",
      usageTotalUsd: 0.02,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    const runs = db.adMarketRunRows.filter((r) => r.platform === "META");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("FAILED");
    expect(res.errors.join(" ")).toContain("no-verified-target");
  });

  test("0 rows + verified-empty evidence + no prior advertisers → OK (a real empty market)", async () => {
    db.setLatestRun(null);
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      advertisers: [],
      resolutions: [],
      outcome: "empty_verified",
      runStatus: "SUCCEEDED",
      targetStatuses: [
        {
          recordType: "target_status",
          subject: "medical spa Miami",
          label: "search",
          status: "empty_verified",
          graphqlHits: 2,
        },
      ],
      runId: "true-empty-run",
      usageTotalUsd: 0.02,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    const runs = db.adMarketRunRows.filter((r) => r.platform === "META");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("OK");
    expect(
      res.errors.some((e) => e.startsWith("meta-softblock-suspected:")),
    ).toBe(false);
  });

  test("advertisers present → heuristic never fires", async () => {
    db.setLatestRun({
      id: "old-ok",
      ranAt: new Date(NOW.getTime() - 40 * 86_400_000),
      status: "OK",
      advertiserCount: 7,
    });
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      advertisers: [{ pageId: "PG1", pageName: "Rival Spa", adCount: 2 }],
      resolutions: [],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
      runId: "facet-run",
      usageTotalUsd: 0.02,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    const runs = db.adMarketRunRows.filter((r) => r.platform === "META");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("OK");
    expect(res.advertiserCount).toBe(1);
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

  test("facet-first · a name-matched facet advertiser seeds fbPageId, then its ad attributes reliably", async () => {
    // Facet-first (2026-07-10): no HTTP pageUrl resolution. A business with NO
    // stored fbPageId is name-matched to a facet advertiser → its pageId is (a)
    // seeded to Business.fbPageId (null-guarded updateMany) and (b) makes the
    // run's ad on that pageId attribute to the business — the full seed→attribute
    // chain, from the facet alone.
    db.setLatestRun(null);
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
      rows: [
        adRow({
          id: "ad-maria",
          pageId: "PAGE_RESOLVED",
          pageName: "Solea Brickell Spa",
        }),
      ],
      resolutions: [],
      advertisers: [
        {
          recordType: "advertiser",
          pageId: "PAGE_RESOLVED",
          pageName: "Solea Brickell Spa",
          adCount: 2,
          searchTerm: "medical spa Miami",
          country: "US",
        },
      ],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      targetStatuses: [],
      runId: "r-seed",
      usageTotalUsd: 0.04,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    // fbPageId seeded on the business (null-guarded updateMany) FROM the facet.
    expect(res.fbPageIdsSeeded).toBe(1);
    expect(db.businessUpdateManyCalls).toHaveLength(1);
    const upd = db.businessUpdateManyCalls[0] as {
      where: { id: string; fbPageId: null };
      data: { fbPageId: string };
    };
    expect(upd.where).toMatchObject({ id: "biz-maria", fbPageId: null });
    expect(upd.data.fbPageId).toBe("PAGE_RESOLVED");

    // The ad on the seeded pageId attributes reliably to the business.
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

// ── P5 (2026-07-10) · chunked targets ───────────────────────────────────────
describe("runMetaAdsForCell · single-run outcomes (facet-first)", () => {
  /** A verified-ok adapter result with one facet advertiser (so the soft-block
   *  heuristic doesn't fire) — override as needed. */
  function okOut(over: Record<string, unknown> = {}) {
    return {
      rows: [],
      resolutions: [],
      advertisers: [
        {
          recordType: "advertiser",
          pageId: "ADV1",
          pageName: "Rival Spa",
          adCount: 3,
          searchTerm: "medical spa Miami",
          country: "US",
        },
      ],
      targetStatuses: [],
      outcome: "ok",
      runStatus: "SUCCEEDED",
      runId: "r-chunk",
      usageTotalUsd: 0.3,
      usageWasEstimated: false,
      ...over,
    };
  }

  test("ignoreFreshness bypasses the 30-day gate (the reconcile continuation path)", async () => {
    db.setLatestRun({
      id: "recent",
      ranAt: new Date(NOW.getTime() - 1 * 86_400_000), // 1 day old → fresh
      status: "PARTIAL",
    });
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce(okOut());

    const res = await runMetaAdsForCell(CELL, NOW, { ignoreFreshness: true });

    expect(res.outcome).toBe("collected");
    expect(apify.metaAdLibrarySearch).toHaveBeenCalledTimes(1);
  });

  test("SALVAGE · a TIMEOUT run that still returned advertisers is PARTIAL (persisted), not FAILED", async () => {
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    // Actor timed out but Meta had already returned the facet → salvage it.
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      resolutions: [],
      advertisers: [
        {
          recordType: "advertiser",
          pageId: "ADV1",
          pageName: "Rival Spa",
          adCount: 4,
          searchTerm: "medical spa Miami",
          country: "US",
        },
      ],
      targetStatuses: [],
      outcome: "timeout",
      runStatus: "TIMED-OUT",
      runId: "salvage-run",
      usageTotalUsd: 0.87,
      usageWasEstimated: true,
    });

    const res = await runMetaAdsForCell(CELL, NOW);

    expect(res.outcome).toBe("collected"); // NOT discarded
    expect(res.advertiserCount).toBe(1); // the facet advertiser persisted
    expect(db.adMarketRunRows).toHaveLength(1);
    const row = db.adMarketRunRows[0];
    expect(row.status).toBe("PARTIAL"); // real data off an unverified run
    expect(row.apifyRunId).toBe("salvage-run");
    expect((row.detailJson as Record<string, unknown>).costEstimated).toBe(
      true,
    );
  });

  test("SALVAGE · a TIMEOUT run with NO data stays FAILED (retryable, discarded)", async () => {
    ctx.resolveCellContext.mockResolvedValueOnce(fakeCtx([]));
    apify.metaAdLibrarySearch.mockResolvedValueOnce({
      rows: [],
      resolutions: [],
      advertisers: [],
      targetStatuses: [],
      outcome: "timeout",
      runStatus: "TIMED-OUT",
      runId: "empty-timeout",
      usageTotalUsd: 0.5,
      usageWasEstimated: true,
    });

    await runMetaAdsForCell(CELL, NOW);

    expect(db.adMarketRunRows[0].status).toBe("FAILED"); // nothing to salvage
    expect(db.adMarketRunRows[0].advertiserCount).toBe(0);
  });
});
