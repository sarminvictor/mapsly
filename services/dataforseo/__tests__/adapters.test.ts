// Tests for the six DataForSEO adapters · happy path + schema + cost.
//
// Bypasses kvCache by importing the `…Uncached` entrypoints. Each test:
//   1. Stubs fetch to return a canned envelope-shaped response.
//   2. Runs the call inside withCronRun → asserts result shape.
//   3. Asserts CronRun.costUsd was incremented by the adapter's unit cost.
//   4. Where useful, asserts a schema rejection.

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
          if (data.costUsd !== undefined) {
            if (
              typeof data.costUsd === "object" &&
              "increment" in data.costUsd
            ) {
              row.costUsd += data.costUsd.increment;
            }
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
  __setCredentialsForTesting,
  __setFetchForTesting,
  __setSleepForTesting,
} from "../client";
import { DATAFORSEO_UNIT_COST_USD } from "../pricing";
import { mapsSearchUncached } from "../maps-search";
import { serpOrganicUncached } from "../serp-organic";
import { serpLocalPackUncached } from "../serp-local-pack";
import { reviewsPullUncached } from "../reviews";
import { keywordVolumeUncached } from "../keyword-volume";
import { lighthouseAuditUncached } from "../lighthouse";

function envelope(result: unknown[] | null): string {
  return JSON.stringify({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "x",
        status_code: 20000,
        status_message: "Ok.",
        result,
      },
    ],
  });
}

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fakeDb.rows.clear();
  fakeDb.nextId = 1;
  __setCredentialsForTesting({ username: "u@example.com", password: "secret" });
  __setSleepForTesting(async () => undefined);
});
afterEach(() => {
  __setFetchForTesting(null);
  __setCredentialsForTesting(null);
  __setSleepForTesting(null);
});

function lastCronRun(): FakeRow {
  const rows = Array.from(fakeDb.rows.values());
  if (rows.length === 0) throw new Error("no CronRun rows in test fake-db");
  return rows[rows.length - 1]!;
}

// ---- maps-search --------------------------------------------------------

describe("mapsSearchUncached", () => {
  test("parses a typical Maps search response + bills mapsSearch unit cost", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope([
            {
              total_count: 2,
              count: 2,
              items: [
                {
                  type: "business",
                  cid: "1234",
                  title: "Solea Brickell Spa",
                  rating: { value: 4.8, votes_count: 247 },
                  latitude: 25.767,
                  longitude: -80.194,
                  is_claimed: true,
                },
                {
                  type: "business",
                  cid: "5678",
                  title: "Another Spa",
                  rating: null,
                },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await withCronRun("test", () =>
      mapsSearchUncached({
        categories: ["med_spa"],
        location_coordinate: "25.767,-80.194,5",
      }),
    );
    expect(out.items).toHaveLength(2);
    expect(out.items[0]!.title).toBe("Solea Brickell Spa");
    expect(out.totalCount).toBe(2);
    expect(lastCronRun().costUsd).toBeCloseTo(
      DATAFORSEO_UNIT_COST_USD.mapsSearch,
      6,
    );
  });

  test("rejects malformed location_coordinate at the schema boundary", async () => {
    const fetchMock = vi.fn<typeof fetch>(); // shouldn't be hit
    __setFetchForTesting(fetchMock);
    await expect(
      withCronRun("test", () =>
        mapsSearchUncached({
          categories: ["med_spa"],
          // Missing radius.
          location_coordinate: "25.767,-80.194",
        }),
      ),
    ).rejects.toThrow(/location_coordinate must be/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---- serp-organic -------------------------------------------------------

describe("serpOrganicUncached", () => {
  test("parses a typical SERP response + returns items[]", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope([
            {
              keyword: "med spa miami",
              items_count: 1,
              items: [
                {
                  type: "organic",
                  rank_group: 1,
                  rank_absolute: 1,
                  domain: "solea.com",
                  title: "Solea Brickell Spa",
                  url: "https://solea.com",
                },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await withCronRun("test", () =>
      serpOrganicUncached({ keyword: "med spa miami" }),
    );
    expect(out.keyword).toBe("med spa miami");
    expect(out.items[0]!.rank_group).toBe(1);
    expect(lastCronRun().costUsd).toBeCloseTo(
      DATAFORSEO_UNIT_COST_USD.serpOrganic,
      6,
    );
  });
});

// ---- serp-local-pack ----------------------------------------------------

describe("serpLocalPackUncached", () => {
  test("parses local-pack items + accepts location_code without coordinate", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope([
            {
              keyword: "med spa brickell",
              items: [
                {
                  type: "maps_search",
                  rank_group: 1,
                  rank_absolute: 1,
                  title: "Solea Brickell Spa",
                  cid: "1234",
                  rating: { value: 4.8, votes_count: 247 },
                  latitude: 25.767,
                  longitude: -80.194,
                },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await withCronRun("test", () =>
      serpLocalPackUncached({
        keyword: "med spa brickell",
        location_code: 2840,
      }),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.cid).toBe("1234");
  });

  test("rejects query without location_code or location_coordinate", async () => {
    __setFetchForTesting(vi.fn<typeof fetch>());
    await expect(
      withCronRun("test", () => serpLocalPackUncached({ keyword: "med spa" })),
    ).rejects.toThrow(/location_code or location_coordinate/);
  });
});

// ---- reviews ------------------------------------------------------------

describe("reviewsPullUncached", () => {
  test("parses reviews + propagates aggregate rating + totalReviewsCount", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope([
            {
              cid: "1234",
              reviews_count: 247,
              rating: { value: 4.8, votes_count: 247 },
              items_count: 1,
              items: [
                {
                  type: "review",
                  rating: { value: 5, rating_max: 5 },
                  review_text: "Loved the staff.",
                  timestamp: "2026-05-19T00:00:00Z",
                  profile_name: "Anonymous",
                  owner_answer: null,
                },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await withCronRun("test", () =>
      reviewsPullUncached({ cid: "1234", depth: 50 }),
    );
    expect(out.items[0]!.review_text).toMatch(/Loved/);
    expect(out.aggregateRating).toBe(4.8);
    expect(out.totalReviewsCount).toBe(247);
    // Variable per-page billing (R.1 fix): items_count=1 → 1 page of 10 →
    // perTen = DATAFORSEO_UNIT_COST_USD.reviews / 50 = 0.00015 →
    // 0.00015 * 10 * ceil(1/10) = 0.0015. The constant 0.0075 is the
    // FALLBACK for a typical depth=50 pull; actual bill scales with items.
    const perTen = DATAFORSEO_UNIT_COST_USD.reviews / 50;
    const expected = perTen * 10 * Math.ceil(1 / 10);
    expect(lastCronRun().costUsd).toBeCloseTo(expected, 6);
  });

  test("rejects query with no business identifier", async () => {
    __setFetchForTesting(vi.fn<typeof fetch>());
    await expect(
      withCronRun("test", () => reviewsPullUncached({})),
    ).rejects.toThrow(/cid, place_id, keyword/);
  });
});

// ---- keyword-volume -----------------------------------------------------

describe("keywordVolumeUncached", () => {
  test("parses keyword rows + bills flat keywordVolume unit cost", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope([
            { keyword: "med spa miami", search_volume: 5400, cpc: 3.21 },
            { keyword: "botox miami", search_volume: 12100, cpc: 5.55 },
          ]),
        ),
      ),
    );

    const out = await withCronRun("test", () =>
      keywordVolumeUncached({
        keywords: ["med spa miami", "botox miami"],
      }),
    );
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]!.search_volume).toBe(5400);
    expect(lastCronRun().costUsd).toBeCloseTo(
      DATAFORSEO_UNIT_COST_USD.keywordVolume,
      6,
    );
  });

  test("rejects a batch larger than 1000 keywords", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    __setFetchForTesting(fetchMock);
    const tooMany = Array.from({ length: 1001 }, (_, i) => `kw${i}`);
    await expect(
      withCronRun("test", () => keywordVolumeUncached({ keywords: tooMany })),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---- lighthouse ---------------------------------------------------------

describe("lighthouseAuditUncached", () => {
  test("normalizes 0..1 category scores to 0..100 + extracts CWV metrics", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope([
            {
              url: "https://solea.com",
              fetch_time: "2026-05-19T00:00:00Z",
              lighthouse_version: "10.4.0",
              categories: {
                performance: { id: "performance", score: 0.92 },
                accessibility: { id: "accessibility", score: 0.97 },
                "best-practices": { id: "best-practices", score: 0.83 },
                seo: { id: "seo", score: 1 },
              },
              audits: {
                "largest-contentful-paint": { numericValue: 1800 },
                "cumulative-layout-shift": { numericValue: 0.04 },
                "total-blocking-time": { numericValue: 120 },
                "first-contentful-paint": { numericValue: 900 },
              },
            },
          ]),
        ),
      ),
    );

    const out = await withCronRun("test", () =>
      lighthouseAuditUncached({ url: "https://solea.com" }),
    );
    expect(out.performance).toBe(92);
    expect(out.accessibility).toBe(97);
    expect(out.bestPractices).toBe(83);
    expect(out.seo).toBe(100);
    expect(out.pwa).toBeNull();
    expect(out.lcpMs).toBe(1800);
    expect(out.cls).toBe(0.04);
    expect(out.tbtMs).toBe(120);
    expect(out.fcpMs).toBe(900);
    expect(out.raw.lighthouse_version).toBe("10.4.0");
    expect(lastCronRun().costUsd).toBeCloseTo(
      DATAFORSEO_UNIT_COST_USD.lighthouse,
      6,
    );
  });

  test("accepts 0..100 category scores already pre-multiplied", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope([
            {
              url: "https://solea.com",
              categories: {
                performance: { id: "performance", score: 87 },
                accessibility: { id: "accessibility", score: 95 },
              },
              audits: {},
            },
          ]),
        ),
      ),
    );

    const out = await withCronRun("test", () =>
      lighthouseAuditUncached({ url: "https://solea.com" }),
    );
    expect(out.performance).toBe(87);
    expect(out.accessibility).toBe(95);
  });
});
