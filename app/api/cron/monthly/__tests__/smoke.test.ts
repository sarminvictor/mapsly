// Smoke tests for the 4 monthly cron handlers (C.10).
//
// Asserts each route module:
//   1. Loads without throwing
//   2. Exports a callable GET handler
//   3. Returns 401 on unauthenticated request (the cronHandler wrapper)
//   4. Has a unique JOB constant on its __test export under the
//      `monthly:` namespace
//
// Mirrors `app/api/cron/weekly/__tests__/smoke.test.ts` — pure import +
// wrapper-shape coverage. Mocked-prisma integration tests live in
// per-route follow-up tasks; they'd add ~400 lines that don't pay back
// on the moat (the prisma queries are simple enough to be self-evident
// from reading the route + walking the schema).

import { describe, expect, test, beforeAll, afterAll } from "vitest";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
beforeAll(() => {
  process.env.CRON_SECRET = "test-cron-secret";
});
afterAll(() => {
  if (ORIGINAL_CRON_SECRET !== undefined) {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  } else {
    delete process.env.CRON_SECRET;
  }
});

const ROUTES = [
  "keyword-volume-refresh",
  "market-census",
  "industry-baseline",
  "email-verification",
] as const;

describe("monthly handlers · smoke", () => {
  test.each(ROUTES)(
    "%s · exports GET + has monthly JOB constant",
    async (route) => {
      const mod = await import(`../${route}/route`);
      expect(typeof mod.GET).toBe("function");
      expect(mod.__test).toBeDefined();
      expect(typeof mod.__test.JOB).toBe("string");
      expect(mod.__test.JOB).toMatch(/^monthly:/);
    },
  );

  test.each(ROUTES)("%s · rejects request without bearer", async (route) => {
    const mod = await import(`../${route}/route`);
    const req = new Request(`https://x/api/cron/monthly/${route}`);
    const res = await mod.GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  test.each(ROUTES)("%s · rejects wrong bearer", async (route) => {
    const mod = await import(`../${route}/route`);
    const req = new Request(`https://x/api/cron/monthly/${route}`, {
      headers: { authorization: "Bearer wrong" },
    });
    const res = await mod.GET(req);
    expect(res.status).toBe(401);
  });

  test("JOB constants are unique across monthly handlers", async () => {
    const jobs = new Set<string>();
    for (const r of ROUTES) {
      const mod = await import(`../${r}/route`);
      const job = mod.__test.JOB;
      expect(jobs.has(job)).toBe(false);
      jobs.add(job);
    }
    expect(jobs.size).toBe(ROUTES.length);
  });
});

// ---- Helpers · industry-baseline ----------------------------------------

describe("industry-baseline · nullableNumber", () => {
  test("returns null for null/undefined/non-finite", async () => {
    const { __test } = await import("../industry-baseline/route");
    expect(__test.nullableNumber(null)).toBeNull();
    expect(__test.nullableNumber(undefined as unknown as number)).toBeNull();
    expect(__test.nullableNumber(Number.NaN)).toBeNull();
    expect(__test.nullableNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(__test.nullableNumber(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  test("rounds to 4 decimal places, preserving sign + zero", async () => {
    const { __test } = await import("../industry-baseline/route");
    expect(__test.nullableNumber(0)).toBe(0);
    expect(__test.nullableNumber(4.123456)).toBe(4.1235);
    expect(__test.nullableNumber(-2.5)).toBe(-2.5);
    expect(__test.nullableNumber(0.00009)).toBe(0.0001);
    expect(__test.nullableNumber(0.00001)).toBe(0);
  });
});

// ---- Constants are sensible --------------------------------------------

describe("monthly handlers · sanity constants", () => {
  test("keyword-volume-refresh · 30d freshness, 1000 batch limit", async () => {
    const { __test } = await import("../keyword-volume-refresh/route");
    expect(__test.MAX_LIMIT).toBe(1000);
    expect(__test.DEFAULT_LIMIT).toBe(1000);
    expect(__test.REFRESH_FRESH_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test("market-census · 10km radius, 200 per query, 50 anchors default", async () => {
    const { __test } = await import("../market-census/route");
    expect(__test.CENSUS_RADIUS_KM).toBe(10);
    expect(__test.CENSUS_LIMIT_PER_QUERY).toBe(200);
    expect(__test.DEFAULT_ANCHOR_LIMIT).toBe(50);
    expect(__test.MAX_ANCHOR_LIMIT).toBe(200);
  });

  test("industry-baseline · 5-row floor for ok bucket", async () => {
    const { __test } = await import("../industry-baseline/route");
    expect(__test.MIN_SAMPLE_SIZE).toBe(5);
    expect(__test.DEFAULT_BUCKET_LIMIT).toBe(250);
    expect(__test.MAX_BUCKET_LIMIT).toBe(1000);
  });

  test("email-verification · 30d freshness, 200 default / 1000 max", async () => {
    const { __test } = await import("../email-verification/route");
    expect(__test.DEFAULT_LIMIT).toBe(200);
    expect(__test.MAX_LIMIT).toBe(1000);
    expect(__test.VERIFY_FRESH_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
