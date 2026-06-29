/**
 * Unit tests for the DOM-fetcher Apify adapter.
 *
 * `runActor` (the Apify transport) is mocked — no network. We assert:
 *   - input mapping: urls / memory / operation / actor id passed correctly
 *   - DomResult mapping: a success item (html) vs a dead-letter item (blocked)
 *   - chunking: >250 URLs fans out into multiple sequential runs
 *
 * withCostCounter wraps the adapter, so the SUT still asserts a CronRun is open
 * (the "no live API" invariant). We open one via runWithCronRun with a fake
 * prisma, mirroring services/email-verify/__tests__/smtp.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- Fake prisma (only CronRun is touched by withCostCounter) ----------

interface FakeRow {
  id: string;
  job: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  costUsd: number | null;
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
            costUsd: data.costUsd == null ? null : data.costUsd,
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
          data: { costUsd?: number | { increment: number } };
        }) => {
          const row = fakeDb.rows.get(where.id);
          if (!row) throw new Error(`no row ${where.id}`);
          if (data.costUsd !== undefined) {
            if (
              typeof data.costUsd === "object" &&
              "increment" in data.costUsd
            ) {
              row.costUsd =
                row.costUsd == null
                  ? null
                  : row.costUsd + data.costUsd.increment;
            } else {
              row.costUsd = data.costUsd;
            }
          }
          return row;
        },
      ),
    },
  },
  Prisma: {},
}));

// ---- Mock the Apify transport ------------------------------------------

const runActorMock = vi.fn();

vi.mock("@/services/apify", () => ({
  runActor: (...args: unknown[]) => runActorMock(...args),
}));

// ---- SUT (imported after mocks) ----------------------------------------

import {
  fetchDoms,
  fetchDomsForCell,
  DOM_FETCHER_ACTOR_ID,
  CHUNK_SIZE,
  SINGLE_URL_MEMORY_MB,
  BATCH_MEMORY_MB,
} from "../fetcher";
import { openCronRun, runWithCronRun } from "@/lib/cost/cost-counter";

/** Run `fn` inside an open CronRun frame so withCostCounter's guard passes. */
async function inCron<T>(fn: () => Promise<T>): Promise<T> {
  const run = await openCronRun("test:dom-fetch");
  return runWithCronRun(run, fn);
}

beforeEach(() => {
  fakeDb.reset();
  runActorMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchDoms · input mapping", () => {
  test("passes urls, actor id, operation, memory, and retire count", async () => {
    runActorMock.mockResolvedValue({
      items: [],
      runId: "run_x",
      usageTotalUsd: 0.01,
    });

    await inCron(() =>
      fetchDoms({ urls: ["https://a.com"], memoryMbytes: 1024 }),
    );

    expect(runActorMock).toHaveBeenCalledTimes(1);
    const arg = runActorMock.mock.calls[0][0];
    expect(arg.actorId).toBe(DOM_FETCHER_ACTOR_ID);
    expect(arg.operation).toBe("dom-fetcher.fetch");
    expect(arg.memoryMbytes).toBe(1024);
    expect(arg.input.urls).toEqual(["https://a.com"]);
    expect(arg.input.country).toBe("US");
    expect(arg.input.cfWaitMs).toBe(14000);
    expect(arg.input.maxConcurrency).toBe(10);
    expect(arg.input.retireBrowserAfterPageCount).toBe(20);
    // Fallback scales with the URL count.
    expect(arg.fallbackCostUsd).toBeCloseTo(0.005, 5);
  });

  test("rejects an empty URL list (Zod min 1)", async () => {
    await expect(inCron(() => fetchDoms({ urls: [] }))).rejects.toThrow();
    expect(runActorMock).not.toHaveBeenCalled();
  });

  test("throws outside a CronRun (no live API invariant)", async () => {
    await expect(fetchDoms({ urls: ["https://a.com"] })).rejects.toThrow(
      /CronRun/,
    );
  });
});

describe("fetchDoms · result mapping", () => {
  test("maps a success item and a dead-letter item", async () => {
    runActorMock.mockResolvedValue({
      items: [
        {
          url: "https://ok.com",
          finalUrl: "https://ok.com/",
          status: 200,
          title: "OK",
          blocked: false,
          htmlBytes: 5,
          html: "<html></html>",
        },
        {
          url: "https://blocked.com",
          status: 403,
          blocked: true,
          failed: true,
          error: "Cloudflare not cleared — retry new session/proxy",
        },
      ],
      runId: "run_y",
      usageTotalUsd: 0.02,
    });

    const { results, runId, usageTotalUsd } = await inCron(() =>
      fetchDoms({ urls: ["https://ok.com", "https://blocked.com"] }),
    );

    expect(runId).toBe("run_y");
    expect(usageTotalUsd).toBe(0.02);
    expect(results).toHaveLength(2);

    const ok = results[0];
    expect(ok.url).toBe("https://ok.com");
    expect(ok.finalUrl).toBe("https://ok.com/");
    expect(ok.status).toBe(200);
    expect(ok.blocked).toBe(false);
    expect(ok.failed).toBe(false);
    expect(ok.html).toBe("<html></html>");

    const dead = results[1];
    expect(dead.url).toBe("https://blocked.com");
    expect(dead.blocked).toBe(true);
    expect(dead.failed).toBe(true);
    expect(dead.html).toBeUndefined();
    expect(dead.error).toContain("Cloudflare");
  });

  test("treats an item with no html as failed even if not flagged", async () => {
    runActorMock.mockResolvedValue({
      items: [{ url: "https://empty.com", status: 200, error: "navigation" }],
      runId: "run_z",
      usageTotalUsd: 0.001,
    });

    const { results } = await inCron(() =>
      fetchDoms({ urls: ["https://empty.com"] }),
    );
    expect(results[0].failed).toBe(true);
  });
});

describe("fetchDomsForCell · chunking + memory", () => {
  test("a single URL uses the 1 GB memory profile", async () => {
    runActorMock.mockResolvedValue({
      items: [{ url: "https://a.com", status: 200, html: "<html></html>" }],
      runId: "r1",
      usageTotalUsd: 0.003,
    });

    await inCron(() => fetchDomsForCell(["https://a.com"]));

    expect(runActorMock).toHaveBeenCalledTimes(1);
    expect(runActorMock.mock.calls[0][0].memoryMbytes).toBe(
      SINGLE_URL_MEMORY_MB,
    );
  });

  test("a small batch uses the 2 GB memory profile in one run", async () => {
    runActorMock.mockResolvedValue({
      items: [],
      runId: "r1",
      usageTotalUsd: 0.01,
    });

    await inCron(() =>
      fetchDomsForCell(["https://a.com", "https://b.com", "https://c.com"]),
    );

    expect(runActorMock).toHaveBeenCalledTimes(1);
    expect(runActorMock.mock.calls[0][0].memoryMbytes).toBe(BATCH_MEMORY_MB);
  });

  test(">250 URLs fan out into 2 sequential runs and concat results", async () => {
    const urls = Array.from(
      { length: CHUNK_SIZE + 10 },
      (_, i) => `https://site-${i}.com`,
    );
    // Each run echoes one result per URL it was given.
    runActorMock.mockImplementation(
      async (opts: { input: { urls: string[] } }) => ({
        items: opts.input.urls.map((u) => ({
          url: u,
          status: 200,
          html: "<html></html>",
        })),
        runId: "rN",
        usageTotalUsd: 0.05,
      }),
    );

    const { results, usageTotalUsd } = await inCron(() =>
      fetchDomsForCell(urls),
    );

    expect(runActorMock).toHaveBeenCalledTimes(2);
    // First run carries CHUNK_SIZE urls, second the remainder.
    expect(runActorMock.mock.calls[0][0].input.urls).toHaveLength(CHUNK_SIZE);
    expect(runActorMock.mock.calls[1][0].input.urls).toHaveLength(10);
    // Results concatenated across both runs, in input order.
    expect(results).toHaveLength(CHUNK_SIZE + 10);
    expect(results[0].url).toBe("https://site-0.com");
    expect(results[CHUNK_SIZE].url).toBe(`https://site-${CHUNK_SIZE}.com`);
    // Cost summed across chunks.
    expect(usageTotalUsd).toBeCloseTo(0.1, 5);
  });

  test("dedupes URLs and ignores blanks before chunking", async () => {
    runActorMock.mockResolvedValue({
      items: [],
      runId: "r1",
      usageTotalUsd: 0,
    });

    await inCron(() =>
      fetchDomsForCell(["https://a.com", "https://a.com", "", "  "]),
    );

    expect(runActorMock).toHaveBeenCalledTimes(1);
    expect(runActorMock.mock.calls[0][0].input.urls).toEqual(["https://a.com"]);
  });

  test("empty input makes no run", async () => {
    const res = await inCron(() => fetchDomsForCell([]));
    expect(runActorMock).not.toHaveBeenCalled();
    expect(res.results).toEqual([]);
    expect(res.usageTotalUsd).toBe(0);
  });
});

describe("fetchDomsForCell · cost ceiling", () => {
  test("stops launching chunks once cumulative usage hits maxUsageUsd", async () => {
    // 3 chunks of 1 URL each (chunkSize 1). Each run bills $0.40. A $0.50
    // ceiling allows the first chunk, then the second pushes cumulative to
    // $0.80 ≥ ceiling, so the third never launches.
    const urls = ["https://a.com", "https://b.com", "https://c.com"];
    runActorMock.mockImplementation(
      async (opts: { input: { urls: string[] } }) => ({
        items: opts.input.urls.map((u) => ({
          url: u,
          status: 200,
          html: "<html></html>",
        })),
        runId: "r",
        usageTotalUsd: 0.4,
      }),
    );

    const { results, usageTotalUsd } = await inCron(() =>
      fetchDomsForCell(urls, { chunkSize: 1, maxUsageUsd: 0.5 }),
    );

    // Only 2 of 3 chunks ran (the 3rd was dropped at the ceiling).
    expect(runActorMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(usageTotalUsd).toBeCloseTo(0.8, 5);
  });

  test("a generous ceiling runs every chunk", async () => {
    const urls = ["https://a.com", "https://b.com", "https://c.com"];
    runActorMock.mockImplementation(
      async (opts: { input: { urls: string[] } }) => ({
        items: opts.input.urls.map((u) => ({
          url: u,
          status: 200,
          html: "<html></html>",
        })),
        runId: "r",
        usageTotalUsd: 0.4,
      }),
    );

    const { results } = await inCron(() =>
      fetchDomsForCell(urls, { chunkSize: 1, maxUsageUsd: 100 }),
    );

    expect(runActorMock).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
  });
});
