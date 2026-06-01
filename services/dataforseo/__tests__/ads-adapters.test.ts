// Tests for the Google Ads Transparency adapters · ads-advertisers + ads-search.
//
// Mirrors adapters.test.ts: stubs fetch with a canned envelope, runs inside
// withCronRun, asserts parsed shape + that the unit cost was billed to the
// CronRun, plus the 40102 "no results" empty path and the ads-search
// "target or advertiser_ids" guard.

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
  __setCredentialsForTesting,
  __setFetchForTesting,
  __setSleepForTesting,
} from "../client";
import { DATAFORSEO_UNIT_COST_USD } from "../pricing";
import { adsAdvertisersUncached } from "../ads-advertisers";
import { adsSearchUncached } from "../ads-search";

function envelope(result: unknown[] | null, taskStatus = 20000): string {
  return JSON.stringify({
    status_code: 20000,
    status_message: "Ok.",
    tasks: [
      {
        id: "x",
        status_code: taskStatus,
        status_message: taskStatus === 40102 ? "No Search Results." : "Ok.",
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

// ---- ads-advertisers ----------------------------------------------------

describe("adsAdvertisersUncached", () => {
  test("parses advertiser items + bills adsAdvertisers unit cost", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope([
            {
              keyword: "med spa",
              items_count: 1,
              items: [
                {
                  type: "ads_advertiser",
                  rank_group: 1,
                  rank_absolute: 1,
                  title: "MD Med Spa",
                  advertiser_id: "AR06725872623227502593",
                  location: "US",
                  verified: true,
                  approx_ads_count: 15,
                },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await withCronRun("test", () =>
      adsAdvertisersUncached({ keyword: "med spa", location_code: 2840 }),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.advertiser_id).toBe("AR06725872623227502593");
    expect(out.items[0]!.approx_ads_count).toBe(15);
    expect(lastCronRun().costUsd).toBeCloseTo(
      DATAFORSEO_UNIT_COST_USD.adsAdvertisers,
      6,
    );
  });

  test("treats 40102 No-Search-Results as a billed empty result (items=[])", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () => jsonResponse(envelope(null, 40102))),
    );
    const out = await withCronRun("test", () =>
      adsAdvertisersUncached({ keyword: "botox calgary", location_code: 2124 }),
    );
    expect(out.items).toEqual([]);
    expect(lastCronRun().costUsd).toBeCloseTo(
      DATAFORSEO_UNIT_COST_USD.adsAdvertisers,
      6,
    );
  });
});

// ---- ads-search ---------------------------------------------------------

describe("adsSearchUncached", () => {
  test("parses creatives (id/format/first+last shown) + bills adsSearch cost", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          envelope([
            {
              items_count: 1,
              items: [
                {
                  type: "ads_search",
                  rank_group: 1,
                  advertiser_id: "AR06725872623227502593",
                  creative_id: "CR07100676311567302657",
                  title: "MD Med Spa",
                  format: "text",
                  verified: true,
                  preview_image: {
                    url: "https://x/simgad/486",
                    height: 400,
                    width: 400,
                  },
                  first_shown: "2025-10-11 02:43:06 +00:00",
                  last_shown: "2026-01-08 16:06:42 +00:00",
                },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await withCronRun("test", () =>
      adsSearchUncached({
        advertiser_ids: ["AR06725872623227502593"],
        location_code: 2840,
      }),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.creative_id).toBe("CR07100676311567302657");
    expect(out.items[0]!.format).toBe("text");
    expect(out.items[0]!.last_shown).toMatch(/2026-01-08/);
    expect(lastCronRun().costUsd).toBeCloseTo(
      DATAFORSEO_UNIT_COST_USD.adsSearch,
      6,
    );
  });

  test("accepts a target domain instead of advertiser_ids", async () => {
    __setFetchForTesting(
      vi.fn<typeof fetch>(async () =>
        jsonResponse(envelope([{ items_count: 0, items: [] }])),
      ),
    );
    const out = await withCronRun("test", () =>
      adsSearchUncached({ target: "theinjectionist.ca", location_code: 2124 }),
    );
    expect(out.items).toEqual([]);
  });

  test("rejects a query with neither target nor advertiser_ids", async () => {
    const fetchMock = vi.fn<typeof fetch>(); // must not be hit
    __setFetchForTesting(fetchMock);
    await expect(
      withCronRun("test", () => adsSearchUncached({ location_code: 2840 })),
    ).rejects.toThrow(/target or advertiser_ids/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
