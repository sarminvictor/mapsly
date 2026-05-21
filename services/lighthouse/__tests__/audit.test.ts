// Integration-style tests for services/lighthouse/audit.
//
// Mocks:
//   - @/lib/prisma (CronRun lifecycle — fake in-memory store, mirrors the
//     pattern used by services/meta-ad-library/__tests__/ads-archive.test.ts)
//   - @/lib/cache (we test the uncached entrypoint, kvCache wrapper untouched)
//   - The DataForSEO HTTP transport (via __setFetchForTesting on
//     services/dataforseo/client) so no DataForSEO network call happens.
//   - The HTML fetch (via this module's own __setFetchForTesting) so we
//     control exactly what HTML the DOM-checks see.
//
// What we cover:
//   - Cron-context invariant: calling lighthouseFullAuditUncached outside
//     withCronRun throws.
//   - Happy path: both legs succeed, scores + DOM checks combined, partial=false.
//   - Partial path A: DataForSEO succeeds, HTML fetch 5xx → partial=true,
//     DOM checks unknown.
//   - Partial path B: HTML fetch succeeds, DataForSEO call throws → partial=true,
//     scores all null but DOM checks populated.
//   - HTML fetch retries on 503 then succeeds.
//   - HTML fetch gives up after retry budget exhausted.
//   - toPersistRow maps every Prisma column correctly.
//   - HTML body truncation (response > MAX_HTML_BYTES).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- Fake Prisma (cost-counter lifecycle) ------------------------------

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
  __setFetchForTesting as setDataForSeoFetch,
  __setCredentialsForTesting,
  __setSleepForTesting as setDataForSeoSleep,
} from "@/services/dataforseo/client";
import {
  lighthouseFullAuditUncached,
  lighthouseDomFetchUncached,
  toPersistRow,
  LighthouseHtmlFetchError,
  __setFetchForTesting,
  __setSleepForTesting,
} from "../audit";
import { LIGHTHOUSE_UNIT_COST_USD } from "../pricing";

// ---- Fixtures ----------------------------------------------------------

const SAMPLE_HTML = `<!doctype html><html>
<head>
  <script type="application/ld+json">{"@type":"MedicalBusiness","name":"Solea Brickell Spa"}</script>
  <script type="application/ld+json">{"@type":"FAQPage"}</script>
</head>
<body>
  <h1>Solea Brickell Spa</h1>
  <p>1450 Brickell Ave, Miami, FL 33131</p>
  <a href="tel:+13055550100">(305) 555-0100</a>
  <button>Book Now</button>
</body></html>`;

function dataForSeoLighthouseResponse(
  partial?: Partial<{
    performance: number;
    seo: number;
    cls: number;
    lcp: number;
  }>,
): Response {
  const result = {
    url: "https://example.com/",
    crawled_url: "https://example.com/",
    fetch_time: "2026-05-19T12:00:00.000Z",
    lighthouse_version: "10.0.0",
    categories: {
      performance: { id: "performance", score: partial?.performance ?? 0.92 },
      accessibility: { id: "accessibility", score: 0.97 },
      "best-practices": { id: "best-practices", score: 0.95 },
      seo: { id: "seo", score: partial?.seo ?? 0.9 },
      pwa: { id: "pwa", score: null },
    },
    audits: {
      "largest-contentful-paint": {
        numericValue: (partial?.lcp ?? 1.6) * 1000,
      },
      "cumulative-layout-shift": { numericValue: partial?.cls ?? 0.04 },
      "total-blocking-time": { numericValue: 120 },
      "first-contentful-paint": { numericValue: 1200 },
    },
  };
  const envelope = {
    status_code: 20000,
    status_message: "Ok.",
    cost: 0.0025,
    tasks: [
      {
        id: "t1",
        status_code: 20000,
        status_message: "Ok.",
        cost: 0.0025,
        result_count: 1,
        result: [result],
      },
    ],
  };
  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

beforeEach(() => {
  fakeDb.reset();
  __setCredentialsForTesting({ username: "u", password: "p" });
  // Sleep mocks so retry tests don't wait real backoff.
  __setSleepForTesting(async () => {});
  setDataForSeoSleep(async () => {});
});

afterEach(() => {
  __setFetchForTesting(null);
  __setSleepForTesting(null);
  setDataForSeoFetch(null);
  setDataForSeoSleep(null);
  __setCredentialsForTesting(null);
  vi.restoreAllMocks();
});

// ---- Tests --------------------------------------------------------------

describe("cron-context invariant", () => {
  test("lighthouseFullAuditUncached throws outside withCronRun", async () => {
    setDataForSeoFetch((async () =>
      dataForSeoLighthouseResponse()) as typeof fetch);
    __setFetchForTesting((async () => htmlResponse(SAMPLE_HTML)) as typeof fetch);

    await expect(
      lighthouseFullAuditUncached({ url: "https://example.com/" }),
    ).rejects.toThrow(/outside of an open CronRun/);
  });

  test("lighthouseDomFetchUncached throws outside withCronRun", async () => {
    __setFetchForTesting((async () => htmlResponse(SAMPLE_HTML)) as typeof fetch);
    await expect(
      lighthouseDomFetchUncached("https://example.com/"),
    ).rejects.toThrow(/outside of an open CronRun/);
  });
});

describe("lighthouseFullAuditUncached · happy path", () => {
  test("both legs succeed → combined result, partial=false, billed once per leg", async () => {
    setDataForSeoFetch((async () =>
      dataForSeoLighthouseResponse()) as typeof fetch);
    __setFetchForTesting((async () => htmlResponse(SAMPLE_HTML)) as typeof fetch);

    const out = await withCronRun("test:weekly:lighthouse", async () => {
      return lighthouseFullAuditUncached({
        url: "https://example.com/",
        nap: {
          name: "Solea Brickell Spa",
          address: "1450 Brickell Ave, Miami, FL 33131",
          phone: "(305) 555-0100",
        },
      });
    });

    expect(out.partial).toBe(false);
    expect(out.legs.lighthouseOk).toBe(true);
    expect(out.legs.domOk).toBe(true);
    expect(out.scores.performance).toBe(92);
    expect(out.scores.seo).toBe(90);
    expect(out.scores.cls).toBeCloseTo(0.04, 2);
    expect(out.scores.lcpMs).toBe(1600);
    expect(out.domChecks.hasLocalBusinessSchema).toBe(true);
    expect(out.domChecks.hasFaqSchema).toBe(true);
    expect(out.domChecks.hasPhoneAboveFold).toBe(true);
    expect(out.domChecks.hasBookingCtaAboveFold).toBe(true);
    expect(out.domChecks.napConsistent).toBe(true);

    // The DataForSEO leg billed $0.0025; the DOM fetch leg billed $0;
    // the composer wraps both at $0 cost. Total = 0.0025.
    const row = [...fakeDb.rows.values()][0];
    expect(row.costUsd).toBeCloseTo(
      LIGHTHOUSE_UNIT_COST_USD.lighthouseAudit,
      6,
    );
  });
});

describe("lighthouseFullAuditUncached · partial paths", () => {
  test("DOM fetch fails on 503 (non-retryable budget exhausted) → partial=true, scores intact, DOM null/false", async () => {
    setDataForSeoFetch((async () =>
      dataForSeoLighthouseResponse()) as typeof fetch);
    // Every HTML fetch attempt returns 503.
    __setFetchForTesting((async () =>
      htmlResponse("upstream busy", 503)) as typeof fetch);

    const out = await withCronRun("test:weekly:lighthouse", async () => {
      return lighthouseFullAuditUncached({ url: "https://example.com/" });
    });

    expect(out.partial).toBe(true);
    expect(out.legs.lighthouseOk).toBe(true);
    expect(out.legs.domOk).toBe(false);
    expect(out.legs.domError).toMatch(/http 503|lighthouse\.dom-fetch/);
    expect(out.scores.performance).toBe(92);
    expect(out.domChecks.hasLocalBusinessSchema).toBe(false);
    expect(out.domChecks.napConsistent).toBeNull();
  });

  test("DataForSEO leg throws → partial=true, DOM checks populated, scores null", async () => {
    setDataForSeoFetch((async () =>
      new Response("internal error", { status: 500 })) as typeof fetch);
    __setFetchForTesting((async () => htmlResponse(SAMPLE_HTML)) as typeof fetch);

    const out = await withCronRun("test:weekly:lighthouse", async () => {
      return lighthouseFullAuditUncached({ url: "https://example.com/" });
    });

    expect(out.partial).toBe(true);
    expect(out.legs.lighthouseOk).toBe(false);
    expect(out.legs.domOk).toBe(true);
    expect(out.scores.performance).toBeNull();
    expect(out.scores.cls).toBeNull();
    expect(out.domChecks.hasLocalBusinessSchema).toBe(true);
    expect(out.domChecks.hasBookingCtaAboveFold).toBe(true);
  });

  test("both legs fail → throws", async () => {
    setDataForSeoFetch((async () =>
      new Response("internal error", { status: 500 })) as typeof fetch);
    __setFetchForTesting((async () =>
      htmlResponse("upstream busy", 503)) as typeof fetch);

    await expect(
      withCronRun("test:weekly:lighthouse", async () =>
        lighthouseFullAuditUncached({ url: "https://example.com/" }),
      ),
    ).rejects.toThrow();
  });
});

describe("HTML fetch retry behavior", () => {
  test("503 then 200 succeeds within retry budget", async () => {
    let calls = 0;
    setDataForSeoFetch((async () =>
      dataForSeoLighthouseResponse()) as typeof fetch);
    __setFetchForTesting((async () => {
      calls++;
      return calls === 1 ? htmlResponse("busy", 503) : htmlResponse(SAMPLE_HTML);
    }) as typeof fetch);

    const out = await withCronRun("test:weekly:lighthouse", async () =>
      lighthouseFullAuditUncached({ url: "https://example.com/" }),
    );
    expect(out.legs.domOk).toBe(true);
    expect(calls).toBe(2);
  });

  test("4xx is non-retryable (no second attempt)", async () => {
    let calls = 0;
    setDataForSeoFetch((async () =>
      dataForSeoLighthouseResponse()) as typeof fetch);
    __setFetchForTesting((async () => {
      calls++;
      return htmlResponse("not found", 404);
    }) as typeof fetch);

    const out = await withCronRun("test:weekly:lighthouse", async () =>
      lighthouseFullAuditUncached({ url: "https://example.com/" }),
    );
    expect(out.legs.domOk).toBe(false);
    expect(out.legs.domError).toMatch(/http 404/);
    expect(calls).toBe(1);
  });
});

describe("LighthouseHtmlFetchError", () => {
  test("carries url, status, and retryable flag", () => {
    const err = new LighthouseHtmlFetchError({
      url: "https://example.com/",
      message: "http 503",
      httpStatus: 503,
      retryable: true,
    });
    expect(err.name).toBe("LighthouseHtmlFetchError");
    expect(err.url).toBe("https://example.com/");
    expect(err.httpStatus).toBe(503);
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/lighthouse\.dom-fetch.*example\.com/);
  });
});

describe("toPersistRow", () => {
  test("maps a full happy-path result into Prisma row shape", async () => {
    setDataForSeoFetch((async () =>
      dataForSeoLighthouseResponse()) as typeof fetch);
    __setFetchForTesting((async () => htmlResponse(SAMPLE_HTML)) as typeof fetch);

    const out = await withCronRun("test:weekly:lighthouse", async () =>
      lighthouseFullAuditUncached({
        url: "https://example.com/",
        nap: {
          name: "Solea Brickell Spa",
          address: "1450 Brickell Ave, Miami, FL 33131",
          phone: "(305) 555-0100",
        },
      }),
    );

    const row = toPersistRow(out, "biz_abc");
    expect(row.businessId).toBe("biz_abc");
    expect(row.performance).toBe(92);
    expect(row.seo).toBe(90);
    expect(row.bestPractices).toBe(95);
    expect(row.accessibility).toBe(97);
    expect(row.lcp).toBe(1.6); // ms→s conversion
    expect(row.fcp).toBe(1.2);
    expect(row.cls).toBeCloseTo(0.04);
    expect(row.tbt).toBe(120);
    expect(row.inp).toBe(120); // INP proxied to TBT
    expect(row.hasLocalBusinessSchema).toBe(true);
    expect(row.hasFaqSchema).toBe(true);
    expect(row.hasBookingCtaAboveFold).toBe(true);
    expect(row.hasPhoneAboveFold).toBe(true);
    expect(row.napConsistent).toBe(true);
    expect(row.techStack).toEqual([]);
    expect(row.rawJson).toBeTruthy();
  });

  test("zeros DOM columns to null when DOM leg failed", async () => {
    setDataForSeoFetch((async () =>
      dataForSeoLighthouseResponse()) as typeof fetch);
    __setFetchForTesting((async () =>
      htmlResponse("upstream busy", 503)) as typeof fetch);

    const out = await withCronRun("test:weekly:lighthouse", async () =>
      lighthouseFullAuditUncached({ url: "https://example.com/" }),
    );
    const row = toPersistRow(out, "biz_xyz");
    expect(row.hasLocalBusinessSchema).toBeNull();
    expect(row.hasFaqSchema).toBeNull();
    expect(row.hasBookingCtaAboveFold).toBeNull();
    expect(row.hasPhoneAboveFold).toBeNull();
    expect(row.napConsistent).toBeNull();
    expect(row.performance).toBe(92); // scores still populated
  });
});

describe("HTML fetch · response truncation", () => {
  test("large bodies are truncated to MAX_HTML_BYTES", async () => {
    const huge = "x".repeat(2_000_000);
    setDataForSeoFetch((async () =>
      dataForSeoLighthouseResponse()) as typeof fetch);
    __setFetchForTesting((async () =>
      htmlResponse(`<body>${huge}</body>`)) as typeof fetch);

    const out = await withCronRun("test:weekly:lighthouse", async () =>
      lighthouseFullAuditUncached({ url: "https://example.com/" }),
    );
    expect(out.legs.domOk).toBe(true);
    // No throw, no OOM — the cap exists exactly for this.
    expect(out.domChecks.hasLocalBusinessSchema).toBe(false);
  });
});
