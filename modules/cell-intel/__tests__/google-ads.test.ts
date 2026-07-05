// Tests for runGoogleAdsForBusiness · the per-business Google-ads billing
// collector (B1). This is a MONEY-SENSITIVE path — a run bills 1 credit and the
// stamped `googleAdsLastAt` cursor drives the 30-day freshness dedup. The four
// billing invariants under test:
//   1. website-less business → non-billable no-op (no adsSearch, no entry, no
//      stamp),
//   2. successful run attributes every creative to THIS business by construction
//      and stamps the freshness cursor,
//   3. verified-empty (0 creatives) is STILL billable → outcome "collected" +
//      cursor stamped (mirrors the contacts/reviews verified-empty invariant),
//   4. a failure does NOT stamp → the retry re-bills, never silently free.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AdsCreativeItem } from "@/services/dataforseo";

// ---- prisma mock --------------------------------------------------------
// A minimal in-memory stand-in. Each method captures its calls so assertions
// can inspect what was persisted. `$transaction` runs the array of prepared
// promises so business.update + adMarketRun.create actually record.
const db = vi.hoisted(() => {
  const adMarketRunRows: Array<Record<string, unknown>> = [];
  const adLibraryEntryUpserts: Array<Record<string, unknown>> = [];
  const businessUpdateCalls: Array<Record<string, unknown>> = [];
  let businessRow: Record<string, unknown> | null = null;
  return {
    adMarketRunRows,
    adLibraryEntryUpserts,
    businessUpdateCalls,
    setBusiness(row: Record<string, unknown> | null) {
      businessRow = row;
    },
    getBusiness() {
      return businessRow;
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    business: {
      findUnique: vi.fn(async () => db.getBusiness()),
      update: vi.fn(async (args: Record<string, unknown>) => {
        db.businessUpdateCalls.push(args);
        return { id: "biz" };
      }),
    },
    adLibraryEntry: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        db.adLibraryEntryUpserts.push(args);
        return { id: `entry_${db.adLibraryEntryUpserts.length}` };
      }),
    },
    adMarketRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.adMarketRunRows.push(data);
        return { id: `run_${db.adMarketRunRows.length}`, ...data };
      }),
    },
    // The collector wraps the stamp + telemetry write in a $transaction. Prisma
    // takes an array of prepared promises; run them so the mocks above record.
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) =>
      Promise.all(ops),
    ),
  },
  Prisma: {},
}));

// ---- service adapter mock ----------------------------------------------
// adsSearch is the ONLY external (paid) call in this path. Mock it at the
// service-adapter boundary — never deeper.
const dfs = vi.hoisted(() => ({ adsSearch: vi.fn() }));
vi.mock("@/services/dataforseo", () => ({
  adsSearch: dfs.adsSearch,
  // adsAdvertisers is imported by the module for the per-CELL path (not under
  // test here) — stub it so the import resolves.
  adsAdvertisers: vi.fn(),
}));

import { runGoogleAdsForBusiness } from "../google-ads";

const BUSINESS_ID = "biz-maria";
const NOW = new Date("2026-06-22T12:00:00.000Z");

function creative(over: Partial<AdsCreativeItem>): AdsCreativeItem {
  return {
    type: "ads_search_result",
    advertiser_id: "AR123",
    creative_id: "CR_1",
    title: "Solea Brickell Spa",
    url: "https://adstransparency.google.com/advertiser/AR123/creative/CR_1",
    verified: true,
    format: "image",
    preview_image: { url: "https://img.example/preview.png" },
    first_shown: "2026-05-01",
    last_shown: "2026-06-20",
    ...over,
  };
}

beforeEach(() => {
  db.adMarketRunRows.length = 0;
  db.adLibraryEntryUpserts.length = 0;
  db.businessUpdateCalls.length = 0;
  db.setBusiness({
    id: BUSINESS_ID,
    domain: null,
    website: "https://soleabrickell.com",
    cellKey: "medical_spa|miami|US",
  });
  dfs.adsSearch.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("runGoogleAdsForBusiness · website gate", () => {
  test("website-less business is a non-billable no-op", async () => {
    // Both domain AND website null → hostOf() returns null → no host to target.
    db.setBusiness({
      id: BUSINESS_ID,
      domain: null,
      website: null,
      cellKey: "medical_spa|miami|US",
    });

    const res = await runGoogleAdsForBusiness(BUSINESS_ID, NOW);

    expect(res.outcome).toBe("no-website");
    // No paid call, no persisted entry, no telemetry run.
    expect(dfs.adsSearch).not.toHaveBeenCalled();
    expect(db.adLibraryEntryUpserts).toHaveLength(0);
    expect(db.adMarketRunRows).toHaveLength(0);
    // Cursor is NOT stamped → nothing to dedup, nothing billed.
    expect(db.businessUpdateCalls).toHaveLength(0);
  });
});

describe("runGoogleAdsForBusiness · successful run", () => {
  test("attributes every creative to THIS business by construction + stamps the cursor", async () => {
    dfs.adsSearch.mockResolvedValueOnce({
      items: [
        creative({ creative_id: "CR_1", title: "Solea Brickell Spa" }),
        creative({ creative_id: "CR_2", title: "Solea Botox Promo" }),
      ],
      operation: "dataforseo.serp.ads-search",
    });

    const res = await runGoogleAdsForBusiness(BUSINESS_ID, NOW);

    expect(res.outcome).toBe("collected");
    expect(res.adCount).toBe(2);
    expect(res.entriesUpserted).toBe(2);

    // adsSearch was targeted on the business's HOST (target-host attribution).
    expect(dfs.adsSearch).toHaveBeenCalledTimes(1);
    expect(dfs.adsSearch.mock.calls[0]![0]).toMatchObject({
      target: "soleabrickell.com",
    });

    // Every creative → AdLibraryEntry(GOOGLE, businessId = this business), no
    // fuzzy match. Attribution is by construction of the target host.
    expect(db.adLibraryEntryUpserts).toHaveLength(2);
    for (const upsert of db.adLibraryEntryUpserts) {
      const create = (upsert as { create: Record<string, unknown> }).create;
      expect(create.platform).toBe("GOOGLE");
      expect(create.businessId).toBe(BUSINESS_ID);
    }
    const ids = db.adLibraryEntryUpserts.map(
      (u) => (u.where as { externalAdId: string }).externalAdId,
    );
    expect(ids).toEqual(["CR_1", "CR_2"]);

    // Freshness cursor stamped to `now` → the 30-day dedup + the 1-credit bill.
    expect(db.businessUpdateCalls).toHaveLength(1);
    const upd = db.businessUpdateCalls[0] as {
      where: { id: string };
      data: { googleAdsLastAt: Date };
    };
    expect(upd.where.id).toBe(BUSINESS_ID);
    expect(upd.data.googleAdsLastAt).toEqual(NOW);

    // Telemetry AdMarketRun(GOOGLE) written OK.
    const runs = db.adMarketRunRows.filter((r) => r.platform === "GOOGLE");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "OK", adCount: 2 });
  });
});

describe("runGoogleAdsForBusiness · verified-empty is billable", () => {
  test("0 creatives still stamps the cursor + collects (not skipped/failed)", async () => {
    // The site genuinely runs no Google ads. This is a VERIFIED empty, not a
    // failure — it MUST bill 1 credit and stamp the cursor so the 30-day gate
    // suppresses a re-run. Mirrors the contacts/reviews verified-empty invariant.
    dfs.adsSearch.mockResolvedValueOnce({
      items: [],
      operation: "dataforseo.serp.ads-search",
    });

    const res = await runGoogleAdsForBusiness(BUSINESS_ID, NOW);

    expect(res.outcome).toBe("collected");
    expect(res.adCount).toBe(0);
    expect(res.entriesUpserted).toBe(0);
    // The paid call WAS made (that's what makes it billable + verified).
    expect(dfs.adsSearch).toHaveBeenCalledTimes(1);
    // No creatives to write, but the cursor IS stamped.
    expect(db.adLibraryEntryUpserts).toHaveLength(0);
    expect(db.businessUpdateCalls).toHaveLength(1);
    expect(
      (db.businessUpdateCalls[0] as { data: { googleAdsLastAt: Date } }).data
        .googleAdsLastAt,
    ).toEqual(NOW);
    // Telemetry run recorded OK with advertiserCount 0 (no ads seen).
    const runs = db.adMarketRunRows.filter((r) => r.platform === "GOOGLE");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "OK",
      adCount: 0,
      advertiserCount: 0,
    });
  });
});

describe("runGoogleAdsForBusiness · failure does not stamp", () => {
  test("adsSearch throwing leaves the cursor unstamped so the retry re-bills", async () => {
    dfs.adsSearch.mockRejectedValueOnce(new Error("upstream 503"));

    const res = await runGoogleAdsForBusiness(BUSINESS_ID, NOW);

    // The run failed to collect — outcome stays the initial "skipped" and the
    // error is captured.
    expect(res.outcome).toBe("skipped");
    expect(res.errors.some((e) => e.includes("upstream 503"))).toBe(true);

    // CRITICAL billing invariant: the freshness cursor is NOT stamped. If it
    // were, the 30-day gate would suppress the retry and the credit spent on
    // the failed call would be silently lost.
    expect(db.businessUpdateCalls).toHaveLength(0);
    // No per-business creatives persisted on a failed run.
    expect(db.adLibraryEntryUpserts).toHaveLength(0);
    // A FAILED telemetry row is recorded (retryable), never OK.
    const runs = db.adMarketRunRows.filter((r) => r.platform === "GOOGLE");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("FAILED");
  });
});
