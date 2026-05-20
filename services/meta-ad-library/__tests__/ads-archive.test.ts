// Unit tests for services/meta-ad-library/ads-archive.
//
// Mocks: @/lib/prisma (CronRun lifecycle) + @/lib/cache (we test the
// uncached entrypoint so the kvCache wrapper isn't exercised here). The
// fetch implementation is replaced via __setFetchForTesting so no network
// call happens.
//
// What we cover:
//   - Missing access token → descriptive throw
//   - Cron-context invariant (calling adsArchiveSearchUncached outside
//     withCronRun throws)
//   - Either search_terms OR search_page_ids required
//   - Single-page happy path returns parsed rows + totalFetched
//   - Paging follow-through stops at MAX_RESULTS_PER_QUERY (truncated=true)
//   - HTTP 4xx/5xx → throws with operation tag + status + body snippet
//   - parseBand() arithmetic + edge cases
//   - Cron-context attribution: cost $0 still records under the operation
//     tag (no exception is the contract — withCostCounter only increments)

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- Fake Prisma for cost-counter --------------------------------------

interface FakeRow {
  id: string;
  job: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  costUsd: number;
}

const fakeDb = {
  rows: new Map<string, FakeRow>(),
  nextId: 1,
  reset() {
    this.rows.clear();
    this.nextId = 1;
  },
};

vi.mock("@/lib/prisma", () => ({
  default: {
    cronRun: {
      create: vi.fn(
        async ({ data }: { data: { job: string; costUsd?: number } }) => {
          const id = `run_${fakeDb.nextId++}`;
          const row: FakeRow = {
            id,
            job: data.job,
            status: "RUNNING",
            startedAt: new Date(),
            finishedAt: null,
            costUsd: data.costUsd ?? 0,
          };
          fakeDb.rows.set(id, row);
          return { id, job: row.job, startedAt: row.startedAt };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            status?: string;
            finishedAt?: Date;
            costUsd?: number | { increment: number };
          };
        }) => {
          const row = fakeDb.rows.get(where.id);
          if (!row) throw new Error(`no row ${where.id}`);
          if (data.status !== undefined) row.status = data.status;
          if (data.finishedAt !== undefined) row.finishedAt = data.finishedAt;
          if (data.costUsd !== undefined) {
            if (
              typeof data.costUsd === "object" &&
              "increment" in data.costUsd
            ) {
              row.costUsd += data.costUsd.increment;
            } else {
              row.costUsd = data.costUsd as number;
            }
          }
          return row;
        },
      ),
    },
  },
  Prisma: {},
}));

// ---- Imports under test (after mocks) ----------------------------------

import { withCronRun } from "@/lib/cost/cost-counter";
import {
  adsArchiveSearchUncached,
  parseBand,
  __setFetchForTesting,
  __setTokenForTesting,
} from "../ads-archive";

// ---- Helpers -----------------------------------------------------------

interface RawRow {
  id: string;
  page_name?: string;
  ad_creative_bodies?: string[];
  impressions?: { lower_bound?: string; upper_bound?: string };
  spend?: { lower_bound?: string; upper_bound?: string };
  ad_active_status?: string | boolean;
}

function okResponse(rows: RawRow[], next?: string): Response {
  const body = {
    data: rows,
    paging: next ? { next } : {},
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    statusText: "Bad Request",
    headers: { "Content-Type": "text/plain" },
  });
}

beforeEach(() => {
  fakeDb.reset();
  __setTokenForTesting("test-token-AAA");
});

afterEach(() => {
  __setFetchForTesting(null);
  __setTokenForTesting(null);
  vi.restoreAllMocks();
});

// ---- Tests --------------------------------------------------------------

describe("adsArchiveSearchUncached · invariants", () => {
  test("throws if no access token configured", async () => {
    __setTokenForTesting(null);
    const originalEnv = process.env.META_AD_LIBRARY_ACCESS_TOKEN;
    delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;

    __setFetchForTesting(vi.fn());

    await expect(
      withCronRun("meta:test", async () => {
        return adsArchiveSearchUncached({
          search_terms: "med spa",
          ad_reached_countries: ["US"],
        });
      }),
    ).rejects.toThrow(/META_AD_LIBRARY_ACCESS_TOKEN/);

    // Restore env so other tests aren't affected.
    if (originalEnv !== undefined) {
      process.env.META_AD_LIBRARY_ACCESS_TOKEN = originalEnv;
    }
  });

  test("throws if called outside an open CronRun", async () => {
    __setFetchForTesting(vi.fn());
    await expect(
      adsArchiveSearchUncached({
        search_terms: "med spa",
        ad_reached_countries: ["US"],
      }),
    ).rejects.toThrow(/outside of an open CronRun/);
  });

  test("requires either search_terms or search_page_ids", async () => {
    __setFetchForTesting(vi.fn());
    await expect(
      withCronRun("meta:test", async () => {
        return adsArchiveSearchUncached({
          ad_reached_countries: ["US"],
        } as never);
      }),
    ).rejects.toThrow(/search_terms or search_page_ids/);
  });

  test("rejects invalid country code", async () => {
    __setFetchForTesting(vi.fn());
    await expect(
      withCronRun("meta:test", async () => {
        return adsArchiveSearchUncached({
          search_terms: "med spa",
          ad_reached_countries: ["usa"], // lowercase 3-letter — invalid
        });
      }),
    ).rejects.toThrow();
  });
});

describe("adsArchiveSearchUncached · happy path", () => {
  test("single page → returns parsed rows + totalFetched", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL): Promise<Response> =>
        okResponse([
          {
            id: "ad_1",
            page_name: "Solea Brickell Spa",
            ad_creative_bodies: ["Glow up this summer"],
            impressions: { lower_bound: "1000", upper_bound: "5000" },
            spend: { lower_bound: "0", upper_bound: "100" },
            ad_active_status: "ACTIVE",
          },
          { id: "ad_2", page_name: "Other Spa" },
        ]),
    );
    __setFetchForTesting(fetchMock as unknown as typeof fetch);

    const result = await withCronRun("meta:test", async () =>
      adsArchiveSearchUncached({
        search_terms: "med spa",
        ad_reached_countries: ["US"],
      }),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.totalFetched).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.rows[0]!.id).toBe("ad_1");
    expect(result.rows[0]!.page_name).toBe("Solea Brickell Spa");

    // First-page URL includes our token + the right fields.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]![0] as string | URL;
    const url = typeof call === "string" ? call : call.toString();
    expect(url).toContain("access_token=test-token-AAA");
    expect(url).toContain("search_terms=med+spa");
    expect(url).toContain("ad_active_status=ALL"); // default
    expect(url).toMatch(/ad_reached_countries=(%5B%22US%22%5D|\["US"\])/);
  });

  test("operation tag encodes country + active status + search subject", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => okResponse([]));
    __setFetchForTesting(fetchMock as unknown as typeof fetch);

    const result = await withCronRun("meta:test", async () =>
      adsArchiveSearchUncached({
        search_terms: "barber shop",
        ad_reached_countries: ["US", "CA"],
        ad_active_status: "ACTIVE",
      }),
    );

    expect(result.operation).toContain("meta-ad-library.ads-archive.search");
    expect(result.operation).toContain("US,CA");
    expect(result.operation).toContain("ACTIVE");
    expect(result.operation).toContain('search="barber shop"');
  });

  test("follows paging.next across multiple pages", async () => {
    const fetchMock = vi.fn(
      async (url: string | URL): Promise<Response> => {
        const u = typeof url === "string" ? url : url.toString();
        if (!u.includes("cursor=PAGE2")) {
          return okResponse(
            [{ id: "ad_1" }, { id: "ad_2" }],
            "https://graph.facebook.com/v19.0/ads_archive?cursor=PAGE2",
          );
        }
        return okResponse([{ id: "ad_3" }, { id: "ad_4" }]);
      },
    );
    __setFetchForTesting(fetchMock as unknown as typeof fetch);

    const result = await withCronRun("meta:test", async () =>
      adsArchiveSearchUncached({
        search_terms: "med spa",
        ad_reached_countries: ["US"],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.rows.map((r) => r.id)).toEqual([
      "ad_1",
      "ad_2",
      "ad_3",
      "ad_4",
    ]);
    expect(result.truncated).toBe(false);
  });

  test("truncates at MAX_RESULTS_PER_QUERY (1500)", async () => {
    // Build a page of 100 + a paging.next, repeat until we exceed 1500.
    // We make each page return 100 unique IDs.
    let pageNum = 0;
    const fetchMock = vi.fn(
      async (): Promise<Response> => {
        pageNum += 1;
        const rows: RawRow[] = Array.from({ length: 100 }, (_, i) => ({
          id: `ad_p${pageNum}_${i}`,
        }));
        // Always return paging.next; the adapter should stop on its own.
        return okResponse(
          rows,
          `https://graph.facebook.com/v19.0/ads_archive?cursor=PAGE${pageNum + 1}`,
        );
      },
    );
    __setFetchForTesting(fetchMock as unknown as typeof fetch);

    const result = await withCronRun("meta:test", async () =>
      adsArchiveSearchUncached({
        search_terms: "med spa",
        ad_reached_countries: ["US"],
        limit: 100,
      }),
    );

    expect(result.totalFetched).toBe(1500);
    expect(result.rows).toHaveLength(1500);
    expect(result.truncated).toBe(true);
    // 1500 / 100 per page = 15 pages.
    expect(fetchMock).toHaveBeenCalledTimes(15);
  });
});

describe("adsArchiveSearchUncached · errors", () => {
  test("HTTP 400 throws with operation tag + status + body snippet", async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        errResponse(
          400,
          JSON.stringify({ error: { message: "Invalid search_terms" } }),
        ),
    );
    __setFetchForTesting(fetchMock as unknown as typeof fetch);

    await expect(
      withCronRun("meta:test", async () =>
        adsArchiveSearchUncached({
          search_terms: "med spa",
          ad_reached_countries: ["US"],
        }),
      ),
    ).rejects.toThrow(/HTTP 400.*Invalid search_terms/);
  });

  test("HTTP 503 throws", async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> => errResponse(503, "upstream"),
    );
    __setFetchForTesting(fetchMock as unknown as typeof fetch);

    await expect(
      withCronRun("meta:test", async () =>
        adsArchiveSearchUncached({
          search_terms: "med spa",
          ad_reached_countries: ["US"],
        }),
      ),
    ).rejects.toThrow(/HTTP 503/);
  });

  test("malformed JSON shape → zod parse error propagates", async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ data: "not-an-array" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    __setFetchForTesting(fetchMock as unknown as typeof fetch);

    await expect(
      withCronRun("meta:test", async () =>
        adsArchiveSearchUncached({
          search_terms: "med spa",
          ad_reached_countries: ["US"],
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("parseBand", () => {
  test("normal both bounds → mid + low + high", () => {
    expect(
      parseBand({ lower_bound: "1000", upper_bound: "5000" }),
    ).toEqual({ mid: 3000, low: 1000, high: 5000 });
  });

  test("zero bound is parseable", () => {
    expect(parseBand({ lower_bound: "0", upper_bound: "100" })).toEqual({
      mid: 50,
      low: 0,
      high: 100,
    });
  });

  test("only lower → single", () => {
    expect(parseBand({ lower_bound: "200" })).toEqual({
      mid: 200,
      low: 200,
      high: 200,
    });
  });

  test("undefined input → null", () => {
    expect(parseBand(undefined)).toBeNull();
  });

  test("both unparseable → null", () => {
    expect(
      parseBand({ lower_bound: "abc", upper_bound: "def" }),
    ).toBeNull();
  });

  test("empty strings → null", () => {
    expect(parseBand({ lower_bound: "", upper_bound: "" })).toBeNull();
  });
});

describe("cost-counter attribution", () => {
  test("CronRun.costUsd stays 0 after a successful call (Meta is free)", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => okResponse([]));
    __setFetchForTesting(fetchMock as unknown as typeof fetch);

    let runId: string | null = null;
    await withCronRun("meta:test", async (ctx) => {
      runId = ctx.runId;
      await adsArchiveSearchUncached({
        search_terms: "med spa",
        ad_reached_countries: ["US"],
      });
    });

    expect(runId).not.toBeNull();
    const row = fakeDb.rows.get(runId!);
    expect(row).toBeDefined();
    expect(row!.costUsd).toBe(0);
    expect(row!.status).toBe("OK");
  });

  test("failed call leaves CronRun status=FAILED + costUsd untouched", async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> => errResponse(500, "boom"),
    );
    __setFetchForTesting(fetchMock as unknown as typeof fetch);

    let runId: string | null = null;
    await expect(
      withCronRun("meta:test", async (ctx) => {
        runId = ctx.runId;
        await adsArchiveSearchUncached({
          search_terms: "med spa",
          ad_reached_countries: ["US"],
        });
      }),
    ).rejects.toThrow();

    expect(runId).not.toBeNull();
    const row = fakeDb.rows.get(runId!);
    expect(row).toBeDefined();
    expect(row!.status).toBe("FAILED");
    expect(row!.costUsd).toBe(0);
  });
});
