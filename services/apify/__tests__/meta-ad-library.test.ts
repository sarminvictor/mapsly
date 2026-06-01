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

/** Mock the 3-call Apify flow: POST run → GET run-status → GET dataset items. */
function mockApify(
  items: unknown[],
  usageTotalUsd: number,
  status = "SUCCEEDED",
): typeof fetch {
  return vi.fn<typeof fetch>(async (url, init) => {
    const u = String(url);
    if (u.includes("/runs") && (init?.method ?? "GET") === "POST") {
      return json({ data: { id: "run1", status: "RUNNING" } });
    }
    if (u.includes("/actor-runs/run1") && !u.includes("/dataset")) {
      return json({
        data: { status, defaultDatasetId: "ds1", stats: { usageTotalUsd } },
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

  test("a FAILED run throws (no usable data)", async () => {
    __setFetchForTesting(mockApify([], 0.01, "FAILED"));
    await expect(
      withCronRun("test", () =>
        metaAdLibrarySearchUncached({ searchTerms: ["botox"] }),
      ),
    ).rejects.toThrow(/failed/i);
    // Cost is still billed (we paid for the failed run).
    expect(lastCronRun().costUsd).toBeCloseTo(0.01, 6);
  });
});
