/**
 * Unit tests for the DECOUPLED Lighthouse enrichment (modules/discovery/
 * enrich-lighthouse.ts).
 *
 * Invariants under test:
 *   - open/walled classification from the stored contact signal + the live DfS
 *     challenge-page detection.
 *   - OPEN sites → cheap DataForSEO audit, persisted.
 *   - WALLED sites → expensive actor Lighthouse, HARD-CAPPED per invocation
 *     (skippedWalledOverCap counts the overflow).
 *   - the cumulative cost ceiling stops further actor spend.
 *   - freshness dedup skips recently-audited businesses.
 *
 * `lighthouseAudit` (DfS) and `fetchLighthouse` (actor) are mocked — no network,
 * no cost. cost-counter is stubbed so the CronRun guard passes. prisma is an
 * in-memory seam covering business.findMany, lighthouseAudit.groupBy + create.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── cost-counter seam: pretend a CronRun is always open ────────────────────

vi.mock("@/lib/cost/cost-counter", () => ({
  getCurrentCronRun: vi.fn(() => ({ id: "run_test", job: "test:lighthouse" })),
}));

// ─── DfS + actor adapter seams ──────────────────────────────────────────────

const lighthouseAuditMock = vi.fn();
const fetchLighthouseMock = vi.fn();

vi.mock("@/services/dataforseo/lighthouse", () => ({
  lighthouseAudit: (...args: unknown[]) => lighthouseAuditMock(...args),
}));

vi.mock("@/services/dom-fetcher", () => ({
  fetchLighthouse: (...args: unknown[]) => fetchLighthouseMock(...args),
  // The orchestrator imports these scale constants from the barrel.
  LIGHTHOUSE_FRESHNESS_DAYS: 30,
  WALLED_LIGHTHOUSE_LIMIT: 10,
  LIGHTHOUSE_RUN_COST_CEILING_USD: 2,
}));

// ─── prisma seam ────────────────────────────────────────────────────────────

interface FakeBiz {
  id: string;
  website: string | null;
  contactScanStatus: string;
  reachability: string;
}

const db = {
  businesses: [] as FakeBiz[],
  /** businessId → latest auditedAt (for groupBy freshness). */
  lastAudit: new Map<string, Date>(),
  /** Captured create() payloads. */
  created: [] as Record<string, unknown>[],
  reset() {
    this.businesses = [];
    this.lastAudit = new Map();
    this.created = [];
  },
};

vi.mock("@/lib/prisma", () => ({
  default: {
    business: {
      findMany: vi.fn(async () => db.businesses),
    },
    lighthouseAudit: {
      groupBy: vi.fn(async () =>
        [...db.lastAudit.entries()].map(([businessId, auditedAt]) => ({
          businessId,
          _max: { auditedAt },
        })),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.created.push(data);
        return { id: `lh_${db.created.length}`, ...data };
      }),
    },
  },
  Prisma: {},
}));

// ─── SUT (after mocks) ──────────────────────────────────────────────────────

import { enrichLighthouseForBusinesses, __test } from "../enrich-lighthouse";

/** A clean (open) DfS Lighthouse result. */
function openDfsResult(seo = 92) {
  return {
    url: "https://x.com",
    performance: 64,
    accessibility: 88,
    bestPractices: 90,
    seo,
    pwa: null,
    lcpMs: 2400,
    cls: 0.02,
    tbtMs: 180,
    fcpMs: 1200,
    raw: {
      audits: {
        "is-crawlable": { score: 1 },
        "http-status-code": { score: 1 },
      },
    },
    operation: "dataforseo.lighthouse.audit",
  };
}

/** A Cloudflare-challenge DfS result (junk: 403 + blocked-from-indexing). */
function challengeDfsResult() {
  return {
    url: "https://walled.com",
    performance: 100,
    accessibility: 50,
    bestPractices: 70,
    seo: 40,
    pwa: null,
    lcpMs: null,
    cls: null,
    tbtMs: null,
    fcpMs: null,
    raw: {
      audits: {
        "http-status-code": { score: 0 },
        "is-crawlable": { score: 0 },
        "meta-refresh": { score: 1 },
      },
    },
    operation: "dataforseo.lighthouse.audit",
  };
}

/** A usable actor Lighthouse block. */
function actorResult(usd = 0.06) {
  return {
    lighthouse: {
      ok: true,
      performance: 55,
      accessibility: 80,
      bestPractices: 85,
      seo: 91,
      lcpMs: 2600,
      cls: 0.03,
      tbtMs: 220,
      fcpMs: 1300,
    },
    runId: "actor_run",
    usageTotalUsd: usd,
  };
}

beforeEach(() => {
  db.reset();
  lighthouseAuditMock.mockReset();
  fetchLighthouseMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── classifyKnown (pure) ────────────────────────────────────────────────────

describe("classifyKnown", () => {
  test("FAILED contact scan → walled", () => {
    expect(
      __test.classifyKnown({
        id: "b",
        website: "x",
        contactScanStatus: "FAILED",
        reachability: "UNKNOWN",
      }),
    ).toBe("walled");
  });

  test("OK contact scan → open", () => {
    expect(
      __test.classifyKnown({
        id: "b",
        website: "x",
        contactScanStatus: "OK",
        reachability: "MULTI",
      }),
    ).toBe("open");
  });

  test("PENDING contact scan → unknown (probe with DfS)", () => {
    expect(
      __test.classifyKnown({
        id: "b",
        website: "x",
        contactScanStatus: "PENDING",
        reachability: "UNKNOWN",
      }),
    ).toBe("unknown");
  });
});

// ─── isChallengeResult (pure) ────────────────────────────────────────────────

describe("isChallengeResult", () => {
  test("403 http-status-code audit → challenge", () => {
    expect(__test.isChallengeResult(challengeDfsResult())).toBe(true);
  });

  test("blocked-from-indexing (is-crawlable score 0) → challenge", () => {
    const r = openDfsResult();
    r.raw.audits["is-crawlable"] = { score: 0 };
    expect(__test.isChallengeResult(r)).toBe(true);
  });

  test("SEO≈40 + meta-refresh → challenge", () => {
    const r = openDfsResult(40);
    (r.raw.audits as Record<string, unknown>)["meta-refresh"] = { score: 1 };
    expect(__test.isChallengeResult(r)).toBe(true);
  });

  test("a clean open audit is NOT a challenge", () => {
    expect(__test.isChallengeResult(openDfsResult())).toBe(false);
  });
});

// ─── routing + persistence ───────────────────────────────────────────────────

describe("enrichLighthouseForBusinesses · routing", () => {
  test("OPEN site → DfS audit persisted, no actor run", async () => {
    db.businesses = [
      {
        id: "b1",
        website: "https://open.com",
        contactScanStatus: "OK",
        reachability: "MULTI",
      },
    ];
    lighthouseAuditMock.mockResolvedValue(openDfsResult());

    const res = await enrichLighthouseForBusinesses(["b1"]);

    expect(res.openAudited).toBe(1);
    expect(res.walledAudited).toBe(0);
    expect(fetchLighthouseMock).not.toHaveBeenCalled();
    expect(db.created).toHaveLength(1);
    expect(db.created[0].techSource).toBe("dataforseo");
    expect(db.created[0].formFactor).toBe("mobile");
    // ms → seconds conversion on lcp.
    expect(db.created[0].lcp).toBeCloseTo(2.4, 3);
  });

  test("known-WALLED site (FAILED scan) → actor run, skips the DfS probe", async () => {
    db.businesses = [
      {
        id: "b2",
        website: "https://walled.com",
        contactScanStatus: "FAILED",
        reachability: "UNKNOWN",
      },
    ];
    fetchLighthouseMock.mockResolvedValue(actorResult());

    const res = await enrichLighthouseForBusinesses(["b2"]);

    expect(lighthouseAuditMock).not.toHaveBeenCalled();
    expect(res.walledAudited).toBe(1);
    expect(res.usageTotalUsd).toBeCloseTo(0.06, 5);
    expect(db.created).toHaveLength(1);
    expect(db.created[0].techSource).toBe("actor");
    expect(db.created[0].diagnostics).toEqual({
      source: "actor",
      walled: true,
    });
  });

  test("DfS challenge page → falls through to the actor", async () => {
    db.businesses = [
      {
        id: "b3",
        website: "https://cf.com",
        contactScanStatus: "PENDING",
        reachability: "UNKNOWN",
      },
    ];
    lighthouseAuditMock.mockResolvedValue(challengeDfsResult());
    fetchLighthouseMock.mockResolvedValue(actorResult());

    const res = await enrichLighthouseForBusinesses(["b3"]);

    expect(lighthouseAuditMock).toHaveBeenCalledTimes(1);
    expect(fetchLighthouseMock).toHaveBeenCalledTimes(1);
    expect(res.openAudited).toBe(0);
    expect(res.walledAudited).toBe(1);
  });
});

describe("enrichLighthouseForBusinesses · walled cap", () => {
  test("caps actor runs at walledLimit and counts the overflow", async () => {
    db.businesses = [
      {
        id: "w1",
        website: "https://w1.com",
        contactScanStatus: "FAILED",
        reachability: "UNKNOWN",
      },
      {
        id: "w2",
        website: "https://w2.com",
        contactScanStatus: "FAILED",
        reachability: "UNKNOWN",
      },
      {
        id: "w3",
        website: "https://w3.com",
        contactScanStatus: "FAILED",
        reachability: "UNKNOWN",
      },
    ];
    fetchLighthouseMock.mockResolvedValue(actorResult());

    const res = await enrichLighthouseForBusinesses(["w1", "w2", "w3"], {
      walledLimit: 2,
    });

    expect(fetchLighthouseMock).toHaveBeenCalledTimes(2);
    expect(res.walledAudited).toBe(2);
    expect(res.skippedWalledOverCap).toBe(1);
  });
});

describe("enrichLighthouseForBusinesses · cost ceiling", () => {
  test("stops actor spend once cumulative usage hits maxUsageUsd", async () => {
    db.businesses = [
      {
        id: "c1",
        website: "https://c1.com",
        contactScanStatus: "FAILED",
        reachability: "UNKNOWN",
      },
      {
        id: "c2",
        website: "https://c2.com",
        contactScanStatus: "FAILED",
        reachability: "UNKNOWN",
      },
      {
        id: "c3",
        website: "https://c3.com",
        contactScanStatus: "FAILED",
        reachability: "UNKNOWN",
      },
    ];
    // Each actor run bills $0.50; a $0.60 ceiling allows the first, then the
    // second pushes cumulative to $1.00 ≥ ceiling so the third is skipped.
    fetchLighthouseMock.mockResolvedValue(actorResult(0.5));

    const res = await enrichLighthouseForBusinesses(["c1", "c2", "c3"], {
      walledLimit: 10,
      maxUsageUsd: 0.6,
    });

    expect(fetchLighthouseMock).toHaveBeenCalledTimes(2);
    expect(res.walledAudited).toBe(2);
    expect(res.skippedOverBudget).toBe(1);
  });
});

describe("enrichLighthouseForBusinesses · pre-flight", () => {
  test("skips a fresh business (audited within the window)", async () => {
    db.businesses = [
      {
        id: "f1",
        website: "https://f1.com",
        contactScanStatus: "OK",
        reachability: "MULTI",
      },
    ];
    db.lastAudit.set("f1", new Date()); // audited just now → fresh

    const res = await enrichLighthouseForBusinesses(["f1"]);

    expect(res.skippedFresh).toBe(1);
    expect(res.processed).toBe(0);
    expect(lighthouseAuditMock).not.toHaveBeenCalled();
  });

  test("skips a business with no website", async () => {
    db.businesses = [
      {
        id: "n1",
        website: null,
        contactScanStatus: "PENDING",
        reachability: "UNKNOWN",
      },
    ];

    const res = await enrichLighthouseForBusinesses(["n1"]);

    expect(res.skippedNoWebsite).toBe(1);
    expect(res.processed).toBe(0);
  });

  test("force re-audits a fresh business", async () => {
    db.businesses = [
      {
        id: "f2",
        website: "https://f2.com",
        contactScanStatus: "OK",
        reachability: "MULTI",
      },
    ];
    db.lastAudit.set("f2", new Date());
    lighthouseAuditMock.mockResolvedValue(openDfsResult());

    const res = await enrichLighthouseForBusinesses(["f2"], { force: true });

    expect(res.skippedFresh).toBe(0);
    expect(res.openAudited).toBe(1);
  });

  test("empty input is a no-op", async () => {
    const res = await enrichLighthouseForBusinesses([]);
    expect(res.processed).toBe(0);
    expect(lighthouseAuditMock).not.toHaveBeenCalled();
  });
});
