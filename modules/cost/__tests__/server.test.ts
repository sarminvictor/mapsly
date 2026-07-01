// Unit tests for the DB-bound cost-estimate + credit-wallet runtime.
//
// Mocks `@/lib/prisma` with an in-memory store covering the four models
// touched: CostEstimate, AgencyWallet, CreditLedger (+ $transaction passthrough
// for the batched writes). Anti-tamper (re-quote / drift) and the hold→settle→
// refund credit math are the invariants under test.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── In-memory DB seam ─────────────────────────────────────────────────────

interface FakeEstimate {
  id: string;
  agencyId: string;
  scopeKind: string;
  enrichmentsJson: unknown;
  scopeRefsJson: unknown;
  grossUsd: number;
  freshHitUsd: number;
  netUsd: number;
  netCredits: number;
  upperBoundUsd: number | null;
  confidence: string;
  priceListVersion: string;
  freshnessAsOf: Date;
  status: string;
  expiresAt: Date;
  createdByUserId: string;
}

interface FakeWallet {
  id: string;
  agencyId: string;
  planCredits: number;
  purchasedCredits: number;
  rolloverCredits: number;
  heldCredits: number;
  cycleResetAt: Date;
}

interface FakeLedger {
  id: string;
  agencyId: string;
  type: string;
  credits: number;
  usd: number;
  runId: string | null;
  note: string | null;
}

const db = {
  estimates: new Map<string, FakeEstimate>(),
  wallets: new Map<string, FakeWallet>(), // keyed by agencyId
  ledger: [] as FakeLedger[],
  seq: 0,
  id(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  },
  reset() {
    this.estimates.clear();
    this.wallets.clear();
    this.ledger = [];
    this.seq = 0;
  },
};

// Decimal-ish: the real Prisma returns Decimal objects with .toString()/Number().
// Our store keeps plain numbers; that's fine for the math under test.

vi.mock("@/lib/prisma", () => {
  const costEstimate = {
    create: vi.fn(async ({ data, select }: { data: any; select?: any }) => {
      const id = db.id("est");
      const row: FakeEstimate = {
        id,
        agencyId: data.agencyId,
        scopeKind: data.scopeKind,
        enrichmentsJson: data.enrichmentsJson,
        scopeRefsJson: data.scopeRefsJson,
        grossUsd: data.grossUsd ?? 0,
        freshHitUsd: data.freshHitUsd ?? 0,
        netUsd: data.netUsd ?? 0,
        netCredits: data.netCredits ?? 0,
        upperBoundUsd: data.upperBoundUsd ?? null,
        confidence: data.confidence,
        priceListVersion: data.priceListVersion,
        freshnessAsOf: data.freshnessAsOf,
        status: data.status ?? "QUOTED",
        expiresAt: data.expiresAt,
        createdByUserId: data.createdByUserId,
      };
      db.estimates.set(id, row);
      return projectEstimate(row, select);
    }),
    findUnique: vi.fn(
      async ({ where, select }: { where: { id: string }; select?: any }) => {
        const row = db.estimates.get(where.id);
        if (!row) return null;
        return projectEstimate(row, select);
      },
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: any }) => {
        const row = db.estimates.get(where.id);
        if (!row) throw new Error("estimate not found");
        Object.assign(row, normalizeNumericFields(data));
        return { ...row };
      },
    ),
  };

  const agencyWallet = {
    findUnique: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { agencyId: string };
        select?: any;
      }) => {
        const w = db.wallets.get(where.agencyId);
        if (!w) return null;
        return projectWallet(w, select);
      },
    ),
    create: vi.fn(async ({ data, select }: { data: any; select?: any }) => {
      const id = db.id("wal");
      const w: FakeWallet = {
        id,
        agencyId: data.agencyId,
        planCredits: data.planCredits ?? 0,
        purchasedCredits: data.purchasedCredits ?? 0,
        rolloverCredits: data.rolloverCredits ?? 0,
        heldCredits: data.heldCredits ?? 0,
        cycleResetAt: data.cycleResetAt,
      };
      db.wallets.set(w.agencyId, w);
      return projectWallet(w, select);
    }),
    update: vi.fn(
      async ({
        where,
        data,
        select,
      }: {
        where: { agencyId: string };
        data: any;
        select?: any;
      }) => {
        const w = db.wallets.get(where.agencyId);
        if (!w) throw new Error("wallet not found");
        applyNumericIncrements(w, data);
        return projectWallet(w, select);
      },
    ),
  };

  const creditLedger = {
    create: vi.fn(async ({ data, select }: { data: any; select?: any }) => {
      const id = db.id("led");
      const row: FakeLedger = {
        id,
        agencyId: data.agencyId,
        type: data.type,
        credits: data.credits ?? 0,
        usd: data.usd ?? 0,
        runId: data.runId ?? null,
        note: data.note ?? null,
      };
      db.ledger.push(row);
      return select ? { id } : row;
    }),
    findFirst: vi.fn(
      async ({
        where,
        select,
      }: {
        where: {
          runId?: string;
          type?: string;
          agencyId?: string;
          note?: string;
        };
        select?: any;
      }) => {
        const row = db.ledger.find(
          (l) =>
            (where.runId == null || l.runId === where.runId) &&
            (where.type == null || l.type === where.type) &&
            (where.agencyId == null || l.agencyId === where.agencyId) &&
            (where.note == null || l.note === where.note),
        );
        if (!row) return null;
        return select ? pick(row, select) : row;
      },
    ),
    aggregate: vi.fn(
      async ({ where }: { where: { runId?: string; type?: string } }) => {
        const sum = db.ledger
          .filter(
            (l) =>
              (where.runId == null || l.runId === where.runId) &&
              (where.type == null || l.type === where.type),
          )
          .reduce((s, l) => s + l.credits, 0);
        return { _sum: { credits: sum } };
      },
    ),
  };

  const prismaMock = {
    costEstimate,
    agencyWallet,
    creditLedger,
    // $transaction just resolves the array of PrismaPromises (our mocks return
    // already-resolved values, so we await them).
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { default: prismaMock, Prisma: {} };
});

// ─── projection helpers (mimic Prisma `select`) ────────────────────────────

function pick(row: object, select: any): any {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  const src = row as Record<string, unknown>;
  for (const k of Object.keys(select)) if (select[k]) out[k] = src[k];
  return out;
}

function projectEstimate(row: FakeEstimate, select?: any): any {
  const r = pick(row, select);
  // Mimic Decimal columns: netUsd has .toString() in real Prisma. We expose a
  // wrapper only on netUsd/grossUsd/etc. when selected so server.ts's
  // `.toString()` + `Number()` work.
  if ("netUsd" in r) r.netUsd = decimal(r.netUsd as number);
  if ("grossUsd" in r) r.grossUsd = decimal(r.grossUsd as number);
  if ("freshHitUsd" in r) r.freshHitUsd = decimal(r.freshHitUsd as number);
  return r;
}

function projectWallet(w: FakeWallet, select?: any): any {
  return pick(w, select);
}

/** Minimal Decimal stand-in: Number() + .toString() resolve to the value. */
function decimal(n: number): any {
  return {
    valueOf: () => n,
    toString: () => String(n),
    toNumber: () => n,
  };
}

function normalizeNumericFields(data: any): any {
  // update() stores plain numbers (server.ts writes numbers directly).
  return { ...data };
}

function applyNumericIncrements(target: any, data: any): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) {
      target[k] = (target[k] ?? 0) + (v as { increment: number }).increment;
    } else if (v && typeof v === "object" && "decrement" in (v as object)) {
      target[k] = (target[k] ?? 0) - (v as { decrement: number }).decrement;
    } else {
      target[k] = v;
    }
  }
}

// ─── Import under test AFTER the mock is registered ─────────────────────────

import {
  authorizeEstimate,
  createCostEstimate,
  getOrCreateWallet,
  grantFreeTierIfNew,
  grantPlanCredits,
  holdCredits,
  reconcileRunCredits,
  refundHold,
  settleRun,
  WalletError,
} from "../server";

const NOW = new Date("2026-06-22T00:00:00Z");

beforeEach(() => db.reset());
afterEach(() => vi.clearAllMocks());

// Seed a wallet with a known available balance.
function seedWallet(agencyId: string, available: number) {
  db.wallets.set(agencyId, {
    id: db.id("wal"),
    agencyId,
    planCredits: available,
    purchasedCredits: 0,
    rolloverCredits: 0,
    heldCredits: 0,
    cycleResetAt: new Date(NOW.getTime() + 30 * 86_400_000),
  });
}

// ─── CostEstimate ───────────────────────────────────────────────────────────

describe("createCostEstimate", () => {
  test("prices a run and persists a QUOTED row with a TTL", async () => {
    const { estimate, result } = await createCostEstimate(
      {
        agencyId: "a1",
        userId: "u1",
        scopeKind: "enrichment",
        enrichments: ["lighthouse"],
        scopeRefs: { lines: [{ enrichment: "lighthouse", total: 10 }] },
        lines: [{ enrichment: "lighthouse", total: 10 }],
        freshnessAsOf: NOW,
      },
      NOW,
    );

    expect(estimate.status).toBe("QUOTED");
    // 10 × $0.00425 (live-verified lighthouse cost) = $0.0425 net.
    expect(result.netUsd).toBeCloseTo(0.0425, 6);
    expect(Number(estimate.netUsd)).toBeCloseTo(0.0425, 6);
    // 15-minute TTL from `now`.
    expect(estimate.expiresAt.getTime()).toBe(NOW.getTime() + 15 * 60_000);
  });
});

describe("authorizeEstimate · anti-tamper", () => {
  test("re-quotes server-side and authorizes when stable", async () => {
    const { estimate } = await createCostEstimate(
      {
        agencyId: "a1",
        userId: "u1",
        scopeKind: "enrichment",
        enrichments: ["lighthouse"],
        scopeRefs: { lines: [{ enrichment: "lighthouse", total: 10 }] },
        lines: [{ enrichment: "lighthouse", total: 10 }],
        freshnessAsOf: NOW,
      },
      NOW,
    );

    const res = await authorizeEstimate(estimate.id, "u1", NOW);
    expect(res.status).toBe("authorized");
    expect(db.estimates.get(estimate.id)?.status).toBe("AUTHORIZED");
  });

  test("ignores a tampered stored netUsd (re-derives from inputs)", async () => {
    const { estimate } = await createCostEstimate(
      {
        agencyId: "a1",
        userId: "u1",
        scopeKind: "enrichment",
        enrichments: ["lighthouse"],
        scopeRefs: { lines: [{ enrichment: "lighthouse", total: 10 }] },
        lines: [{ enrichment: "lighthouse", total: 10 }],
        freshnessAsOf: NOW,
      },
      NOW,
    );

    // Client tampers the persisted number to $0.0001 — the server must ignore it.
    db.estimates.get(estimate.id)!.netUsd = 0.0001;

    const res = await authorizeEstimate(estimate.id, "u1", NOW);
    // Live re-quote (0.0425) drifts massively from the tampered stored 0.0001 →
    // needs_requote (the anti-tamper catch).
    expect(res.status).toBe("needs_requote");
    if (res.status === "needs_requote") {
      expect(res.reason).toBe("drift");
      expect(res.result.netUsd).toBeCloseTo(0.0425, 6);
    }
  });

  test("forbids a different user", async () => {
    const { estimate } = await createCostEstimate(
      {
        agencyId: "a1",
        userId: "u1",
        scopeKind: "enrichment",
        enrichments: ["lighthouse"],
        scopeRefs: { lines: [{ enrichment: "lighthouse", total: 10 }] },
        lines: [{ enrichment: "lighthouse", total: 10 }],
        freshnessAsOf: NOW,
      },
      NOW,
    );
    const res = await authorizeEstimate(estimate.id, "intruder", NOW);
    expect(res.status).toBe("forbidden");
  });

  test("expires past the TTL", async () => {
    const { estimate } = await createCostEstimate(
      {
        agencyId: "a1",
        userId: "u1",
        scopeKind: "enrichment",
        enrichments: ["lighthouse"],
        scopeRefs: { lines: [{ enrichment: "lighthouse", total: 10 }] },
        lines: [{ enrichment: "lighthouse", total: 10 }],
        freshnessAsOf: NOW,
      },
      NOW,
    );
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const res = await authorizeEstimate(estimate.id, "u1", later);
    expect(res.status).toBe("expired");
    expect(db.estimates.get(estimate.id)?.status).toBe("EXPIRED");
  });
});

// ─── Wallet credit math ─────────────────────────────────────────────────────

describe("getOrCreateWallet", () => {
  test("computes availableCredits = plan + purchased + rollover − held", async () => {
    db.wallets.set("a1", {
      id: "w1",
      agencyId: "a1",
      planCredits: 100,
      purchasedCredits: 50,
      rolloverCredits: 10,
      heldCredits: 20,
      cycleResetAt: NOW,
    });
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.availableCredits).toBe(140);
  });

  test("lazily creates an empty wallet", async () => {
    const w = await getOrCreateWallet("new-agency", NOW);
    expect(w.availableCredits).toBe(0);
    expect(db.wallets.has("new-agency")).toBe(true);
  });
});

describe("holdCredits", () => {
  test("reserves credits and bumps heldCredits", async () => {
    seedWallet("a1", 100);
    const res = await holdCredits("a1", 30, "run1", 1.5);
    expect(res.held).toBe(30);
    expect(res.wallet.heldCredits).toBe(30);
    expect(res.wallet.availableCredits).toBe(70);
    expect(db.ledger.filter((l) => l.type === "HOLD")).toHaveLength(1);
  });

  test("throws when the hold exceeds available", async () => {
    seedWallet("a1", 10);
    await expect(holdCredits("a1", 25, "run1")).rejects.toBeInstanceOf(
      WalletError,
    );
  });
});

describe("settleRun", () => {
  test("charges actual + refunds the unused hold, releasing the reservation", async () => {
    seedWallet("a1", 100);
    await holdCredits("a1", 40, "run1");
    // Actual cost was only 25 → charge 25, refund 15.
    const res = await settleRun("run1", 25);
    expect(res.charged).toBe(25);
    expect(res.refunded).toBe(15);
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.heldCredits).toBe(0); // hold fully released
    expect(w.planCredits).toBe(75); // 25 drawn from the plan bucket first
    expect(w.purchasedCredits).toBe(0); // purchased untouched
    expect(db.ledger.filter((l) => l.type === "SETTLE")).toHaveLength(1);
    expect(db.ledger.filter((l) => l.type === "REFUND")).toHaveLength(1);
  });

  test("clamps actual to the hold (never over-charges)", async () => {
    seedWallet("a1", 100);
    await holdCredits("a1", 20, "run1");
    const res = await settleRun("run1", 35); // actual > hold
    expect(res.charged).toBe(20);
    expect(res.refunded).toBe(0);
  });

  test("throws when no hold exists", async () => {
    seedWallet("a1", 100);
    await expect(settleRun("ghost", 5)).rejects.toBeInstanceOf(WalletError);
  });
});

describe("refundHold", () => {
  test("releases the full outstanding hold", async () => {
    seedWallet("a1", 100);
    await holdCredits("a1", 40, "run1");
    const res = await refundHold("run1");
    expect(res.refunded).toBe(40);
    expect(res.charged).toBe(0);
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.heldCredits).toBe(0);
    expect(db.ledger.filter((l) => l.type === "REFUND")).toHaveLength(1);
  });
});

// ─── Plan grants + free tier ─────────────────────────────────────────────────

describe("grantFreeTierIfNew", () => {
  test("grants the one-time free credits exactly once", async () => {
    await grantFreeTierIfNew("a1");
    let w = await getOrCreateWallet("a1", NOW);
    expect(w.planCredits).toBe(50);
    expect(w.availableCredits).toBe(50);
    await grantFreeTierIfNew("a1"); // idempotent
    w = await getOrCreateWallet("a1", NOW);
    expect(w.planCredits).toBe(50);
    expect(db.ledger.filter((l) => l.note === "free-tier-grant")).toHaveLength(
      1,
    );
  });

  test("skips agencies already funded by a paid grant", async () => {
    await grantPlanCredits("a1", "SOLO", null, "p1");
    await grantFreeTierIfNew("a1");
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.planCredits).toBe(600); // unchanged by the free grant
  });
});

describe("grantPlanCredits", () => {
  test("sets the plan bucket to the tier amount", async () => {
    await grantPlanCredits("a1", "GROWTH", null, "p1");
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.planCredits).toBe(1600);
  });

  test("is idempotent per (agency, tier, period)", async () => {
    await grantPlanCredits("a1", "SOLO", null, "period-1");
    await grantPlanCredits("a1", "SOLO", null, "period-1"); // replay
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.planCredits).toBe(600);
    expect(db.ledger.filter((l) => l.type === "TOPUP")).toHaveLength(1);
  });

  test("rolls the prior period's unused plan credits over (1-cycle)", async () => {
    await grantPlanCredits("a1", "SOLO", null, "period-1"); // plan=600
    await grantPlanCredits("a1", "SOLO", null, "period-2"); // re-grant
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.planCredits).toBe(600);
    expect(w.rolloverCredits).toBe(600);
    expect(w.availableCredits).toBe(1200);
  });
});

// ─── Run close-out ───────────────────────────────────────────────────────────

describe("reconcileRunCredits", () => {
  test("charges the full hold when the run made progress", async () => {
    seedWallet("a1", 100);
    await holdCredits("a1", 30, "run1");
    await reconcileRunCredits("run1", { hadProgress: true });
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.heldCredits).toBe(0);
    expect(w.availableCredits).toBe(70); // 30 charged
    expect(db.ledger.filter((l) => l.type === "SETTLE")).toHaveLength(1);
  });

  test("refunds the entire hold when the run produced nothing", async () => {
    seedWallet("a1", 100);
    await holdCredits("a1", 30, "run1");
    await reconcileRunCredits("run1", { hadProgress: false });
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.heldCredits).toBe(0);
    expect(w.availableCredits).toBe(100); // nothing charged
  });

  test("charges only the actual when supplied (refunds the diff)", async () => {
    seedWallet("a1", 100);
    await holdCredits("a1", 40, "run1");
    await reconcileRunCredits("run1", { actualCredits: 10, hadProgress: true });
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.availableCredits).toBe(90); // 10 charged, 30 refunded
  });

  test("is a no-op for a run with no hold", async () => {
    seedWallet("a1", 100);
    await reconcileRunCredits("ghost", { hadProgress: true });
    const w = await getOrCreateWallet("a1", NOW);
    expect(w.availableCredits).toBe(100);
  });
});

describe("authorizeEstimate · discovery scope", () => {
  test("re-quotes discovery from stored cells via estimateDiscovery ($0, always free)", async () => {
    // DISCOVERY_PRICE is $0/listing (docs/pricing-strategy.md: "Discovery is
    // free"), so this can no longer be distinguished from an enrichment
    // re-quote BY DOLLAR AMOUNT alone (both land on $0). The regression this
    // guards is structural: authorizeEstimate for scopeKind="discovery" MUST
    // route through reQuoteEstimate's `estimateDiscovery(extractDiscoveryCells(...))`
    // branch and stay authorized — if that branch were ever removed (falling
    // through to a plain `estimateRun({lines:[]})`), the numbers would still
    // match here by coincidence, but a future non-zero DISCOVERY_PRICE would
    // immediately expose the bug via this same test.
    const { estimate } = await createCostEstimate(
      {
        agencyId: "a1",
        userId: "u1",
        scopeKind: "discovery",
        enrichments: [],
        scopeRefs: {
          kind: "discovery",
          cells: [
            {
              cellKey: "x|miami|US",
              lastDiscoveredAt: null,
              expectedListings: 100,
            },
          ],
          lines: [],
        },
        lines: [],
        freshnessAsOf: NOW,
      },
      NOW,
    );
    // Mimic the action: the stored quote is discovery's real $0.
    db.estimates.get(estimate.id)!.netUsd = 0;

    const res = await authorizeEstimate(estimate.id, "u1", NOW);
    expect(res.status).toBe("authorized");
    if (res.status === "authorized") {
      expect(res.result.netUsd).toBe(0);
    }
  });
});
