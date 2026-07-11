// Integration-ish unit tests for the enrichment server actions (Phase 9).
//
// Mocks `@/lib/auth` (the session) and `@/lib/prisma` with an in-memory store
// covering the three models the actions touch (AgencyMember, CostEstimate,
// EnrichmentRun). The invariants under test:
//   - preflightEnrichAction builds estimator lines (per-business × count,
//     per-cell × cellCount) and persists the SAME numbers estimateRun produces.
//   - runEnrichAction creates a PENDING EnrichmentRun with unitsRequested =
//     the BUSINESS count (WP4-3 · one progress unit = leads, not Σ family
//     lines), and returns its id.
//   - auth + agency membership gate both actions.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { estimateRun } from "@/modules/cost/estimate";
import { ENRICHMENT_PRICES } from "@/modules/cost/pricing";
import { buildEnrichLines } from "../enrich-lines";

// ─── Mockable session ───────────────────────────────────────────────────────

let SESSION: { user?: { id?: string } } | null = {
  user: { id: "user-1" },
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => SESSION),
}));

// ─── In-memory prisma seam ──────────────────────────────────────────────────

interface FakeEstimate {
  id: string;
  agencyId: string;
  scopeKind: string;
  scopeRefsJson: unknown;
  enrichmentsJson: unknown;
  netUsd: number;
  netCredits: number;
  status: string;
  expiresAt: Date;
  priceListVersion: string;
  createdByUserId: string;
}

interface FakeRun {
  id: string;
  agencyId: string;
  triggeredByUserId: string;
  scopeRefsJson: unknown;
  enrichmentsJson: unknown;
  status: string;
  unitsRequested: number;
}

const db = {
  members: [] as {
    id: string;
    userId: string;
    agencyId: string;
    role: string;
  }[],
  estimates: [] as FakeEstimate[],
  runs: [] as FakeRun[],
  /** Business ids the cell-resolution findMany returns (WP5-4 filter tests). */
  cellBusinesses: [] as string[],
  /** businessId → cellKey for the scope fix (2026-07-10) · preflight derives the
   *  effective market cells from the SCOPED businesses' Business.cellKey. */
  businessCellKeys: {} as Record<string, string>,
  /** Every `where` the cell-resolution findMany was called with. */
  businessWheres: [] as Record<string, unknown>[],
  seq: 0,
  id(p: string) {
    this.seq += 1;
    return `${p}_${this.seq}`;
  },
  reset() {
    // role OWNER — runEnrichAction's WP5-8 spend gate (requireSpendMember)
    // selects { id, agencyId, role } and rejects non-OWNER/ADMIN callers.
    this.members = [
      { id: "mem-1", userId: "user-1", agencyId: "agency-1", role: "OWNER" },
    ];
    this.estimates = [];
    this.runs = [];
    this.cellBusinesses = [];
    this.businessCellKeys = {};
    this.businessWheres = [];
    this.seq = 0;
  },
};

function pick<T extends object>(
  row: T,
  select?: Record<string, boolean>,
): Partial<T> | T {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(select)) {
    if (select[k]) out[k] = (row as Record<string, unknown>)[k];
  }
  return out as Partial<T>;
}

vi.mock("@/lib/prisma", () => {
  const agencyMember = {
    findFirst: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { userId: string };
        select?: Record<string, boolean>;
      }) => {
        const row = db.members.find((m) => m.userId === where.userId);
        if (!row) return null;
        return select ? pick(row, select) : row;
      },
    ),
  };

  const costEstimate = {
    create: vi.fn(
      async ({
        data,
        select,
      }: {
        data: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        const id = db.id("est");
        const row: FakeEstimate = {
          id,
          agencyId: data.agencyId as string,
          scopeKind: data.scopeKind as string,
          scopeRefsJson: data.scopeRefsJson,
          enrichmentsJson: data.enrichmentsJson,
          netUsd: (data.netUsd as number) ?? 0,
          netCredits: (data.netCredits as number) ?? 0,
          status: (data.status as string) ?? "QUOTED",
          expiresAt: data.expiresAt as Date,
          priceListVersion: data.priceListVersion as string,
          createdByUserId: data.createdByUserId as string,
        };
        db.estimates.push(row);
        return pick(row, select);
      },
    ),
    findUnique: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = db.estimates.find((e) => e.id === where.id);
        if (!row) return null;
        return select ? pick(row, select) : row;
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = db.estimates.find((e) => e.id === where.id);
        if (!row) throw new Error("estimate not found");
        Object.assign(row, data);
        return { ...row };
      },
    ),
  };

  const enrichmentRun = {
    create: vi.fn(
      async ({
        data,
        select,
      }: {
        data: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        const id = db.id("run");
        const row: FakeRun = {
          id,
          agencyId: data.agencyId as string,
          triggeredByUserId: data.triggeredByUserId as string,
          scopeRefsJson: data.scopeRefsJson,
          enrichmentsJson: data.enrichmentsJson,
          status: (data.status as string) ?? "PENDING",
          unitsRequested: (data.unitsRequested as number) ?? 0,
        };
        db.runs.push(row);
        return pick(row, select);
      },
    ),
  };

  // The cell-resolution scope query (WP5-4 · preflight resolves cellKeys →
  // businessIds through rawListWhere). Freshness reads (loadFreshTimestamps)
  // also hit business.findMany with an `id: { in }` where — those return []
  // (countFreshForRun degrades to "nothing fresh", which these tests want).
  const business = {
    findMany: vi.fn(
      async ({
        where,
        take,
        select,
      }: {
        where: Record<string, unknown>;
        take?: number;
        select?: Record<string, boolean>;
      }) => {
        // Scope fix (2026-07-10) · effective-cell resolution for EXPLICIT
        // businessIds: preflight reads `{ id:{in}, select:{cellKey} }` to derive
        // the market cells from the scoped businesses. Shape-match it exactly and
        // return the seeded cellKey per id. NOT a cell-resolution query → do NOT
        // push to businessWheres (the filter tests assert its length).
        const idIn =
          where?.id && typeof where.id === "object" && "in" in where.id
            ? ((where.id as { in: string[] }).in ?? [])
            : null;
        if (select?.cellKey === true && idIn) {
          return idIn
            .map((id) => db.businessCellKeys[id])
            .filter((c): c is string => Boolean(c))
            .map((cellKey) => ({ cellKey }));
        }
        if (where && "cellKey" in where) {
          db.businessWheres.push(where);
          const ids =
            take != null ? db.cellBusinesses.slice(0, take) : db.cellBusinesses;
          return ids.map((id) => ({ id }));
        }
        return [];
      },
    ),
  };

  // P3 · the preflight's permanent-failure exclusion reads FAILED job history —
  // empty here, so no pair is "Not available" and line totals stay unchanged.
  const enrichmentJob = { findMany: vi.fn(async () => []) };

  return {
    default: {
      agencyMember,
      costEstimate,
      enrichmentRun,
      business,
      enrichmentJob,
    },
    Prisma: {},
  };
});

// Keep the cost-engine math real (createCostEstimate + authorizeEstimate re-quote
// against the in-memory prisma above) but stub the wallet side — credit hold /
// grant invariants are covered in modules/cost/__tests__/server.test.ts.
vi.mock("@/modules/cost/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/cost/server")>();
  return {
    ...actual,
    grantFreeTierIfNew: vi.fn(async () => {}),
    holdCredits: vi.fn(async () => ({
      wallet: null,
      ledgerId: "led_1",
      held: 1,
    })),
  };
});

// ─── Import under test AFTER the mocks ──────────────────────────────────────

import { preflightEnrichAction, runEnrichAction } from "../enrich-actions";

beforeEach(() => {
  db.reset();
  SESSION = { user: { id: "user-1" } };
});
afterEach(() => vi.clearAllMocks());

// ─── preflightEnrichAction ──────────────────────────────────────────────────

describe("preflightEnrichAction", () => {
  test("prices per-business × count and persists estimateRun's numbers", async () => {
    const r = await preflightEnrichAction({
      businessIds: ["b1", "b2", "b3"],
      cellKeys: ["c1"],
      enrichments: ["contacts"],
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // Re-derive the expected math from the pure layer.
    const lines = buildEnrichLines({
      enrichments: ["contacts"],
      businessCount: 3,
      cellCount: 1,
    });
    const expected = estimateRun({ lines });

    expect(r.netUsd).toBeCloseTo(expected.netUsd, 6);
    expect(r.netCredits).toBe(expected.netCredits);
    expect(r.gate).toBe(expected.gate);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.total).toBe(3);
    expect(r.lines[0]?.label).toBe(ENRICHMENT_PRICES.contacts.label);

    // The persisted estimate carries the SAME net and stores the lines in
    // scopeRefsJson for the server-side re-quote.
    const stored = db.estimates[0];
    expect(stored?.scopeKind).toBe("enrichment");
    expect(stored?.netUsd).toBeCloseTo(expected.netUsd, 6);
    const refs = stored?.scopeRefsJson as { lines?: unknown };
    expect(Array.isArray(refs.lines)).toBe(true);
  });

  test("per-cell families price the scoped businesses' DISTINCT cells (scope fix)", async () => {
    // Scope fix (2026-07-10) · selecting one market's leads must run Meta/SERP
    // only on THOSE leads' cells — not every visible cell of the research. The
    // caller may pass extra cellKeys (all visible markets), but the effective
    // cells are derived server-side from the scoped businesses' Business.cellKey.
    // b1,b2 → c1; b3 → c2 ⇒ 2 distinct cells, NOT the 4 cellKeys passed.
    db.businessCellKeys = { b1: "c1", b2: "c1", b3: "c2" };
    const r = await preflightEnrichAction({
      businessIds: ["b1", "b2", "b3"],
      cellKeys: ["c1", "c2", "c3", "c4"], // 4 visible cells passed — must be ignored
      enrichments: ["meta_ads"],
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.lines[0]?.unit).toBe("cell");
    expect(r.lines[0]?.total).toBe(2); // c1 + c2 only, not the 4 passed cellKeys

    // The stored scope re-quoted on run carries the SAME 2 cells — so the fan-out
    // and the billing agree with the quote (no all-markets over-charge/over-run).
    const refs = db.estimates[0]?.scopeRefsJson as { cellKeys?: string[] };
    expect(new Set(refs.cellKeys)).toEqual(new Set(["c1", "c2"]));
  });

  test("WP2-2 · topN caps the scope server-side (priced set == stored set)", async () => {
    const r = await preflightEnrichAction({
      businessIds: ["b1", "b2", "b3", "b4", "b5"],
      cellKeys: [],
      enrichments: ["contacts"],
      topN: 2,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // The quote prices the SLICED subset, not the full selection…
    expect(r.lines[0]?.total).toBe(2);
    // …and the persisted scope (what runEnrichAction reconstructs from,
    // anti-tamper) is the same 2-business subset — server-authoritative.
    const refs = db.estimates[0]?.scopeRefsJson as { businessIds?: string[] };
    expect(refs.businessIds).toEqual(["b1", "b2"]);
  });

  test("rejects an unauthenticated caller", async () => {
    SESSION = null;
    const r = await preflightEnrichAction({
      businessIds: ["b1"],
      cellKeys: [],
      enrichments: ["contacts"],
    });
    expect(r.status).toBe("unauthorized");
  });

  test("rejects a caller without an agency membership", async () => {
    db.members = [];
    const r = await preflightEnrichAction({
      businessIds: ["b1"],
      cellKeys: [],
      enrichments: ["contacts"],
    });
    expect(r.status).toBe("forbidden");
  });

  test("rejects invalid input (no enrichments)", async () => {
    const r = await preflightEnrichAction({
      businessIds: ["b1"],
      cellKeys: [],
      enrichments: [],
    });
    expect(r.status).toBe("invalid_input");
  });
});

// ─── runEnrichAction ─────────────────────────────────────────────────────────

describe("runEnrichAction", () => {
  test("authorizes the estimate + creates a PENDING EnrichmentRun", async () => {
    // Preflight mints the estimate (real math); run consumes it by id.
    const pf = await preflightEnrichAction({
      businessIds: ["b1", "b2", "b3"],
      cellKeys: ["c1", "c2"],
      enrichments: ["contacts", "meta_ads"],
    });
    expect(pf.status).toBe("ok");
    if (pf.status !== "ok") return;

    const r = await runEnrichAction({ estimateId: pf.estimateId });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    const run = db.runs.find((x) => x.id === r.runId);
    expect(run).toBeDefined();
    expect(run?.status).toBe("PENDING");
    // WP4-3 · ONE progress unit = BUSINESSES, not Σ family lines. With explicit
    // businessIds ["b1","b2","b3"], unitsRequested is the 3 businesses — not
    // contacts(3)+meta_ads(2)=5 job-rows (which made a multi-family bar march in
    // family-sized jumps / open partway).
    expect(run?.unitsRequested).toBe(3);
    expect(run?.triggeredByUserId).toBe("user-1");

    // Single-use: the estimate is CONSUMED once the run is created.
    const est = db.estimates.find((e) => e.id === pf.estimateId);
    expect(est?.status).toBe("CONSUMED");
  });

  test("rejects an already-consumed estimate (single-use)", async () => {
    const pf = await preflightEnrichAction({
      businessIds: ["b1"],
      cellKeys: [],
      enrichments: ["contacts"],
    });
    if (pf.status !== "ok") throw new Error("preflight failed");
    await runEnrichAction({ estimateId: pf.estimateId }); // first use
    const again = await runEnrichAction({ estimateId: pf.estimateId });
    expect(again.status).toBe("invalid_input");
  });

  test("rejects an unauthenticated caller", async () => {
    SESSION = null;
    const r = await runEnrichAction({ estimateId: "est_x" });
    expect(r.status).toBe("unauthorized");
  });
});

// ─── WP5-4 · pre-enrich filters → scope threading ───────────────────────────

describe("preflightEnrichAction · filters (WP5-4)", () => {
  test("filters ride the cell-resolution where + website gate composes", async () => {
    db.cellBusinesses = ["b1", "b2", "b3"];
    const r = await preflightEnrichAction({
      businessIds: [],
      cellKeys: ["c1"],
      enrichments: ["contacts"], // website-dependent → hasWebsite forced
      filters: {
        minRating: 4,
        minReviewCount: 25,
        reachability: ["MULTI", "RICH"],
      },
    });
    expect(r.status).toBe("ok");

    // The scope query used rawListWhere with the caller's filters MERGED with
    // the website gate (the gate always wins for site-reading families).
    expect(db.businessWheres).toHaveLength(1);
    const where = db.businessWheres[0]!;
    expect(where.cellKey).toEqual({ in: ["c1"] });
    expect(where.rating).toEqual({ gte: 4 });
    expect(where.reviewCount).toEqual({ gte: 25 });
    expect(where.reachability).toEqual({ in: ["MULTI", "RICH"] });
    expect(where.website).toEqual({ not: null });

    // The FILTERED set became the estimate's stored (anti-tamper) scope — the
    // priced set, the held credits, and the fan-out are the same subset.
    const refs = db.estimates[0]?.scopeRefsJson as { businessIds?: string[] };
    expect(refs.businessIds).toEqual(["b1", "b2", "b3"]);
  });

  test("filters compose with topN — filters first, then best-N within them", async () => {
    db.cellBusinesses = ["b1", "b2", "b3", "b4", "b5"];
    const r = await preflightEnrichAction({
      businessIds: [],
      cellKeys: ["c1"],
      enrichments: ["contacts"],
      filters: { minReviewCount: 10 },
      topN: 2,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // The quote priced the top-2 OF the filtered set…
    expect(r.lines[0]?.total).toBe(2);
    // …and stored exactly that subset.
    const refs = db.estimates[0]?.scopeRefsJson as { businessIds?: string[] };
    expect(refs.businessIds).toEqual(["b1", "b2"]);
    // The filter still reached the where.
    expect(db.businessWheres[0]?.reviewCount).toEqual({ gte: 10 });
  });

  test("non-website families don't force the website gate", async () => {
    db.cellBusinesses = ["b1"];
    const r = await preflightEnrichAction({
      businessIds: [],
      cellKeys: ["c1"],
      enrichments: ["reviews"], // Google-presence family — no site needed
      filters: { minRating: 4 },
    });
    expect(r.status).toBe("ok");
    const where = db.businessWheres[0]!;
    expect(where.rating).toEqual({ gte: 4 });
    expect(where.website).toBeUndefined();
  });

  test("explicit businessIds ignore filters (caller already chose rows)", async () => {
    const r = await preflightEnrichAction({
      businessIds: ["b9"],
      cellKeys: [],
      enrichments: ["contacts"],
      filters: { minRating: 4.5 },
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // No cell-resolution query ran; the explicit set is priced as-is.
    expect(db.businessWheres).toHaveLength(0);
    expect(r.lines[0]?.total).toBe(1);
    const refs = db.estimates[0]?.scopeRefsJson as { businessIds?: string[] };
    expect(refs.businessIds).toEqual(["b9"]);
  });
});
