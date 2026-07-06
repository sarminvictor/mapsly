// Tests for the Apify Meta Ad Library consumer · start→poll→dataset transport.
//
// Stubs fetch with the 3-call Apify sequence (run start → run status →
// dataset items), runs inside withCronRun, and asserts: ads parsed, the run's
// variable usageTotalUsd billed to the CronRun, and the searchTerms/pageIds
// guard.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeRow {
  id: string;
  job: string;
  costUsd: number;
}
const fakeDb = { rows: new Map<string, FakeRow>(), nextId: 1 };

vi.mock("@/lib/prisma", () => ({
  default: {
    cronRun: {
      create: vi.fn(async ({ data }: { data: { job: string } }) => {
        const id = `run_${fakeDb.nextId++}`;
        fakeDb.rows.set(id, { id, job: data.job, costUsd: 0 });
        return { id, job: data.job, startedAt: new Date() };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { costUsd?: number | { increment: number } };
        }) => {
          const row = fakeDb.rows.get(where.id);
          if (!row) return null;
          if (
            data.costUsd !== undefined &&
            typeof data.costUsd === "object" &&
            "increment" in data.costUsd
          ) {
            row.costUsd += data.costUsd.increment;
          }
          return row;
        },
      ),
    },
    $executeRaw: vi.fn(async () => 1),
  },
  Prisma: { sql: vi.fn() },
}));

import { withCronRun } from "@/lib/cost/cost-counter";
import {
  __setFetchForTesting,
  __setTokenForTesting,
  __setSleepForTesting,
} from "../client";
import { metaAdLibrarySearchUncached } from "../meta-ad-library";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Mock the Apify flow: POST run → GET run-status → GET RUN_SUMMARY kv record →
 * GET dataset items. `runSummary` is optional — when omitted the KV record read
 * 404s (the actor wrote none) and the adapter infers the outcome from status.
 */
function mockApify(
  items: unknown[],
  usageTotalUsd: number,
  status = "SUCCEEDED",
  runSummary?: unknown,
): typeof fetch {
  return vi.fn<typeof fetch>(async (url, init) => {
    const u = String(url);
    if (u.includes("/runs") && (init?.method ?? "GET") === "POST") {
      return json({ data: { id: "run1", status: "RUNNING" } });
    }
    if (u.includes("/key-value-stores/") && u.includes("/RUN_SUMMARY")) {
      if (runSummary === undefined) {
        return new Response("not found", { status: 404 });
      }
      return json(runSummary);
    }
    if (u.includes("/actor-runs/run1") && !u.includes("/dataset")) {
      return json({
        data: {
          status,
          defaultDatasetId: "ds1",
          defaultKeyValueStoreId: "kv1",
          stats: { usageTotalUsd },
        },
      });
    }
    if (u.includes("/datasets/ds1/items")) {
      return json(items);
    }
    return new Response("not found", { status: 404 });
  });
}

const SAMPLE_AD = {
  id: "2818188265033120",
  pageId: "515259585001220",
  pageName: "French Pharmacy",
  adCreativeBody: "RUN — your skin's new secret weapon ✨",
  ctaText: "Shop now",
  displayFormat: "VIDEO",
  platforms: ["FACEBOOK", "INSTAGRAM", "THREADS"],
  startDate: "2025-08-08T07:00:00.000Z",
  isActive: false,
  collationCount: 4,
  searchTerm: "botox",
  country: "CA",
};

beforeEach(() => {
  fakeDb.rows.clear();
  fakeDb.nextId = 1;
  __setTokenForTesting("apify_api_test");
  __setSleepForTesting(async () => undefined);
});
afterEach(() => {
  __setFetchForTesting(null);
  __setTokenForTesting(null);
  __setSleepForTesting(null);
});

function lastCronRun(): FakeRow {
  const rows = Array.from(fakeDb.rows.values());
  if (rows.length === 0) throw new Error("no CronRun rows in test fake-db");
  return rows[rows.length - 1]!;
}

describe("metaAdLibrarySearchUncached", () => {
  test("parses actor dataset rows + bills the run's usageTotalUsd", async () => {
    __setFetchForTesting(mockApify([SAMPLE_AD], 0.0123));
    const out = await withCronRun("test", () =>
      metaAdLibrarySearchUncached({
        searchTerms: ["botox"],
        countries: ["CA"],
        maxItems: 25,
      }),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.pageName).toBe("French Pharmacy");
    expect(out.rows[0]!.platforms).toContain("INSTAGRAM");
    expect(out.usageTotalUsd).toBeCloseTo(0.0123, 6);
    expect(lastCronRun().costUsd).toBeCloseTo(0.0123, 6);
  });

  test("INC-48 · bounded re-fetch picks up a late-finalized usageTotalUsd (not the fallback)", async () => {
    // Apify finalizes stats.usageTotalUsd a beat AFTER the run goes terminal, so
    // the first post-terminal read still shows 0. A single fixed re-fetch lost
    // that race and billed the ~$0.02 fallback. The bounded poll must keep
    // reading until the real cost lands, so the CronRun ledger is accurate.
    let runStatusReads = 0;
    const REAL_USD = 0.43; // the tell-tale ~$0.43/cell INC-48 under-billed
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const u = String(url);
      if (u.includes("/runs") && (init?.method ?? "GET") === "POST") {
        return json({ data: { id: "run1", status: "RUNNING" } });
      }
      if (u.includes("/key-value-stores/") && u.includes("/RUN_SUMMARY")) {
        return new Response("not found", { status: 404 });
      }
      if (u.includes("/actor-runs/run1") && !u.includes("/dataset")) {
        runStatusReads += 1;
        // Terminal immediately, but usage stays 0 for the first 3 reads
        // (the in-loop read + first two bounded re-fetches), then finalizes.
        const usageTotalUsd = runStatusReads >= 4 ? REAL_USD : 0;
        return json({
          data: {
            status: "SUCCEEDED",
            defaultDatasetId: "ds1",
            defaultKeyValueStoreId: "kv1",
            stats: { usageTotalUsd },
          },
        });
      }
      if (u.includes("/datasets/ds1/items")) return json([SAMPLE_AD]);
      return new Response("not found", { status: 404 });
    });
    __setFetchForTesting(fetchMock);
    const out = await withCronRun("test", () =>
      metaAdLibrarySearchUncached({
        searchTerms: ["botox"],
        countries: ["CA"],
      }),
    );
    // Billed the REAL finalized cost, not the $0.02 fallback (the INC-48 bug).
    expect(out.usageTotalUsd).toBeCloseTo(REAL_USD, 6);
    expect(lastCronRun().costUsd).toBeCloseTo(REAL_USD, 6);
  });

  test("skips malformed dataset items instead of failing the batch", async () => {
    __setFetchForTesting(
      mockApify([SAMPLE_AD, { not_an_ad: true }, { id: 123 }], 0.01),
    );
    const out = await withCronRun("test", () =>
      metaAdLibrarySearchUncached({ pageIds: ["515259585001220"] }),
    );
    // Only the valid row survives; { id: 123 } fails (id must be string).
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.id).toBe("2818188265033120");
    expect(out.advertisers).toEqual([]);
  });

  test("partitions advertiser-facet records into `advertisers`, never `rows`", async () => {
    // A keyword search now returns the advertiser facet (the real signal) and
    // usually NO creative rows. The advertiser record has no `id`, so it must
    // not leak into `rows`; the discriminated `recordType` check fires first.
    const ADVERTISER = {
      recordType: "advertiser",
      pageId: "515259585001220",
      pageName: "French Pharmacy",
      adCount: 12,
      searchTerm: "dentist San Francisco",
      country: "US",
    };
    __setFetchForTesting(
      mockApify(
        [
          ADVERTISER,
          {
            recordType: "advertiser",
            pageId: "999",
            pageName: null,
            adCount: null,
            searchTerm: null,
            country: null,
          },
        ],
        0.0086,
      ),
    );
    const out = await withCronRun("test", () =>
      metaAdLibrarySearchUncached({
        searchTerms: ["dentist San Francisco"],
        countries: ["US"],
      }),
    );
    expect(out.rows).toEqual([]);
    expect(out.advertisers).toHaveLength(2);
    expect(out.advertisers[0]).toMatchObject({
      pageId: "515259585001220",
      pageName: "French Pharmacy",
      adCount: 12,
    });
    // Nullable fields tolerated (Meta omits ad counts on some facet rows).
    expect(out.advertisers[1]).toMatchObject({
      pageId: "999",
      pageName: null,
      adCount: null,
    });
  });

  test("a keyword run can carry BOTH advertiser facet + creative rows", async () => {
    __setFetchForTesting(
      mockApify(
        [
          SAMPLE_AD,
          {
            recordType: "advertiser",
            pageId: "ADV_1",
            pageName: "Rival Co",
            adCount: 5,
            searchTerm: "botox",
            country: "CA",
          },
        ],
        0.02,
      ),
    );
    const out = await withCronRun("test", () =>
      metaAdLibrarySearchUncached({
        searchTerms: ["botox"],
        countries: ["CA"],
      }),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.id).toBe("2818188265033120");
    expect(out.advertisers).toHaveLength(1);
    expect(out.advertisers[0]!.pageId).toBe("ADV_1");
  });

  test("rejects a query with neither searchTerms nor pageIds", async () => {
    const fetchMock = vi.fn<typeof fetch>(); // must not be hit
    __setFetchForTesting(fetchMock);
    await expect(
      withCronRun("test", () => metaAdLibrarySearchUncached({})),
    ).rejects.toThrow(/searchTerms, pageIds, or pageUrls/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("throws (and is cron-context-enforced) outside an open CronRun", async () => {
    __setFetchForTesting(mockApify([SAMPLE_AD], 0.01));
    await expect(
      metaAdLibrarySearchUncached({ searchTerms: ["botox"] }),
    ).rejects.toThrow(/CronRun/);
  });

  test("salvages partial data + bills cost when the run TIMED-OUT", async () => {
    // The actor pushes incrementally; a boundary timeout still carries data we
    // paid for. It must be returned, not discarded.
    __setFetchForTesting(mockApify([SAMPLE_AD], 0.05, "TIMED-OUT"));
    const out = await withCronRun("test", () =>
      metaAdLibrarySearchUncached({
        searchTerms: ["botox"],
        countries: ["CA"],
      }),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.usageTotalUsd).toBeCloseTo(0.05, 6);
    expect(lastCronRun().costUsd).toBeCloseTo(0.05, 6); // still billed
  });

  test("a FAILED run surfaces outcome=blocked (not thrown) + still bills", async () => {
    // The actor now deliberately Actor.fail()s on an all-blocked run AND writes
    // a RUN_SUMMARY the adapter must see. So a FAILED run is no longer thrown —
    // it returns runStatus=FAILED + a classified outcome so the consumer can
    // record a retryable failure (not a clean 0). Cost is still billed.
    __setFetchForTesting(
      mockApify([], 0.01, "FAILED", {
        outcome: "blocked",
        primerOk: true,
        counts: { ok: 0, empty_verified: 0, blocked: 1, timeout: 0 },
      }),
    );
    const out = await withCronRun("test", () =>
      metaAdLibrarySearchUncached({ searchTerms: ["botox"] }),
    );
    expect(out.outcome).toBe("blocked");
    expect(out.runStatus).toBe("FAILED");
    expect(out.rows).toEqual([]);
    expect(out.advertisers).toEqual([]);
    expect(lastCronRun().costUsd).toBeCloseTo(0.01, 6);
  });

  test("reads the actor's RUN_SUMMARY outcome (empty_verified) verbatim", async () => {
    // A SUCCEEDED run with 0 data + a RUN_SUMMARY of empty_verified is a REAL
    // empty market — the adapter must surface that (cacheable), not guess.
    __setFetchForTesting(
      mockApify([], 0.008, "SUCCEEDED", {
        outcome: "empty_verified",
        primerOk: true,
        counts: { ok: 0, empty_verified: 1, blocked: 0, timeout: 0 },
      }),
    );
    const out = await withCronRun("test", () =>
      metaAdLibrarySearchUncached({ searchTerms: ["dermal fillers"] }),
    );
    expect(out.outcome).toBe("empty_verified");
    expect(out.runStatus).toBe("SUCCEEDED");
  });

  test("partitions target_status records + infers outcome without RUN_SUMMARY", async () => {
    // No RUN_SUMMARY (older/degraded read) → outcome inferred. A SUCCEEDED run
    // carrying a creative row + an empty_verified target_status = ok.
    const TARGET_STATUS = {
      recordType: "target_status",
      subject: "botox",
      label: "search",
      status: "ok",
      items: 1,
      advertisers: 0,
      graphqlHits: 3,
      country: "CA",
    };
    __setFetchForTesting(mockApify([SAMPLE_AD, TARGET_STATUS], 0.02));
    const out = await withCronRun("test", () =>
      metaAdLibrarySearchUncached({
        searchTerms: ["botox"],
        countries: ["CA"],
      }),
    );
    expect(out.rows).toHaveLength(1); // status record NOT bucketed as an ad
    expect(out.targetStatuses).toHaveLength(1);
    expect(out.targetStatuses[0]!.status).toBe("ok");
    expect(out.outcome).toBe("ok");
  });
});
