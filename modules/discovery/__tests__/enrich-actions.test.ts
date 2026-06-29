// Integration-ish unit tests for the enrichment server actions (Phase 9).
//
// Mocks `@/lib/auth` (the session) and `@/lib/prisma` with an in-memory store
// covering the three models the actions touch (AgencyMember, CostEstimate,
// EnrichmentRun). The invariants under test:
//   - preflightEnrichAction builds estimator lines (per-business × count,
//     per-cell × cellCount) and persists the SAME numbers estimateRun produces.
//   - runEnrichAction creates a PENDING EnrichmentRun with unitsRequested = the
//     sum of all line totals, and returns its id.
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
  members: [] as { userId: string; agencyId: string }[],
  estimates: [] as FakeEstimate[],
  runs: [] as FakeRun[],
  seq: 0,
  id(p: string) {
    this.seq += 1;
    return `${p}_${this.seq}`;
  },
  reset() {
    this.members = [{ userId: "user-1", agencyId: "agency-1" }];
    this.estimates = [];
    this.runs = [];
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

  return {
    default: { agencyMember, costEstimate, enrichmentRun },
    Prisma: {},
  };
});

// Keep the cost-engine math real (createCostEstimate + authorizeEstimate re-quote
// against the in-memory prisma above) but stub the wallet side — credit hold /
// grant invariants are covered in modules/cost/__tests__/server.test.ts.
vi.mock("@/modules/cost/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/cost/server")>();
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

  test("per-cell families use cellKeys length as the unit count", async () => {
    const r = await preflightEnrichAction({
      businessIds: ["b1", "b2"],
      cellKeys: ["c1", "c2", "c3"],
      enrichments: ["meta_ads"],
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.lines[0]?.unit).toBe("cell");
    expect(r.lines[0]?.total).toBe(3); // cellCount, not businessCount
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
    // contacts (per-business → 3) + meta_ads (per-cell → 2) = 5 units.
    expect(run?.unitsRequested).toBe(5);
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
