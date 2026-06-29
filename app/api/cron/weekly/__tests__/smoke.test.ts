// Smoke tests for the weekly cron handlers.
//
// Asserts each route module:
//   1. Loads without throwing
//   2. Exports a callable GET handler
//   3. Returns 401 on unauthenticated request (the cronHandler wrapper)
//   4. Has a unique JOB constant on its __test export
//
// These do NOT exercise prisma / adapter mocking — that lives in
// per-route integration tests (deferred follow-up). Their purpose is to
// catch import-time syntax errors, mismatched export names, and missing
// auth gating in one pass.

import { describe, expect, test, beforeAll, afterAll } from "vitest";

// Force cronHandler's bearer check to a known value so unauthenticated
// fetches deterministically return 401 (rather than a 500 from missing env).
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
  "business-profile-refresh",
  "reviews-delta",
  "search-visibility",
  "lighthouse-audit",
  "competitor-diff",
  "snapshot-write",
  "contact-enrich",
] as const;

describe("weekly handlers · smoke", () => {
  test.each(ROUTES)(
    "%s · exports GET + has unique JOB constant",
    async (route) => {
      const mod = await import(`../${route}/route`);
      expect(typeof mod.GET).toBe("function");
      // __test object exposes JOB for inspection by tests + grep.
      expect(mod.__test).toBeDefined();
      expect(typeof mod.__test.JOB).toBe("string");
      expect(mod.__test.JOB).toMatch(/^weekly:/);
    },
  );

  test.each(ROUTES)("%s · rejects request without bearer", async (route) => {
    const mod = await import(`../${route}/route`);
    const req = new Request(`https://x/api/cron/weekly/${route}`);
    const res = await mod.GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  test.each(ROUTES)("%s · rejects wrong bearer", async (route) => {
    const mod = await import(`../${route}/route`);
    const req = new Request(`https://x/api/cron/weekly/${route}`, {
      headers: { authorization: "Bearer wrong" },
    });
    const res = await mod.GET(req);
    expect(res.status).toBe(401);
  });

  test("JOB constants are unique across weekly handlers", async () => {
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
