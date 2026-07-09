// Server-action tests for the discovery actions (Phase 2 · WP5-8 spend gate).
//
// Mocks `@/lib/auth` (session), `@/lib/prisma` (in-memory), and the cost/server
// seam. `authorizeEstimate` is stubbed per-test so each case drives the gate
// branch by the authorized quote's `netCredits` directly — decoupled from live
// discovery pricing (DISCOVERY_PRICE is zeroed today, so a real preflight nets
// $0; the gate must still be correct the moment pricing is re-enabled).
// Invariants:
//   - WP5-8 spend gate: when the authorized quote HOLDS credits (stale/
//     undiscovered cells cost money), a STAFF caller is denied
//     ({ status: "forbidden" }) — a STAFF seat can't spend the pooled wallet via
//     a discovery run. OWNER runs it fine.
//   - a $0 all-fresh re-open holds nothing → STAFF stays ALLOWED (free read of
//     an already-mapped market).
//
// kickDispatch is stubbed; after() is a no-op outside a request scope.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── Mockable session ───────────────────────────────────────────────────────

let SESSION: { user?: { id?: string } } | null = { user: { id: "user-1" } };

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => SESSION) }));

// ─── In-memory prisma seam ──────────────────────────────────────────────────

interface FakeEstimate {
  id: string;
  agencyId: string;
  scopeKind: string;
  scopeRefsJson: unknown;
  enrichmentsJson: unknown;
  grossUsd: number;
  freshHitUsd: number;
  upperBoundUsd: number;
  netUsd: number;
  netCredits: number;
  status: string;
  expiresAt: Date;
  priceListVersion: string;
  createdByUserId: string;
  consumedByRunId: string | null;
}

interface FakeDiscovery {
  id: string;
  agencyId: string;
  requestedByUserId: string;
  idempotencyKey: string;
  status: string;
  cellKeys: string[];
  cellCount: number;
  signalsJson: unknown;
}

const db = {
  members: [] as {
    id: string;
    userId: string;
    agencyId: string;
    role: string;
    createdAt: Date;
  }[],
  estimates: [] as FakeEstimate[],
  discoveries: [] as FakeDiscovery[],
  // Controls the monthly cost-incurring map counter (seats.ts cap gate).
  costIncurringMapCount: 0,
  seq: 0,
  id(p: string) {
    this.seq += 1;
    return `${p}_${this.seq}`;
  },
  reset() {
    // role OWNER by default — individual tests override to STAFF to exercise
    // the WP5-8 gate.
    this.members = [
      {
        id: "mem-1",
        userId: "user-1",
        agencyId: "agency-1",
        role: "OWNER",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];
    this.estimates = [];
    this.discoveries = [];
    this.costIncurringMapCount = 0;
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
    // Serves BOTH callerAgencyId ({ agencyId }) and callerAgencyMember
    // ({ id, agencyId, role } + orderBy createdAt asc). Oldest wins.
    findFirst: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { userId: string };
        select?: Record<string, boolean>;
      }) => {
        const rows = db.members
          .filter((m) => m.userId === where.userId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const row = rows[0];
        if (!row) return null;
        return pick(row, select);
      },
    ),
  };

  const trackedLocation = {
    // Never-discovered cell → null → plan refetches → holds credits.
    findFirst: vi.fn(async () => null),
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
          grossUsd: (data.grossUsd as number) ?? 0,
          freshHitUsd: (data.freshHitUsd as number) ?? 0,
          upperBoundUsd: (data.upperBoundUsd as number) ?? 0,
          netUsd: (data.netUsd as number) ?? 0,
          netCredits: (data.netCredits as number) ?? 0,
          status: (data.status as string) ?? "QUOTED",
          expiresAt: data.expiresAt as Date,
          priceListVersion: data.priceListVersion as string,
          createdByUserId: data.createdByUserId as string,
          consumedByRunId: null,
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
        return pick(row, select);
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

  const discovery = {
    upsert: vi.fn(
      async ({
        where,
        create,
        select,
      }: {
        where: { idempotencyKey: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        let row = db.discoveries.find(
          (d) => d.idempotencyKey === where.idempotencyKey,
        );
        if (!row) {
          row = {
            id: db.id("disc"),
            agencyId: create.agencyId as string,
            requestedByUserId: create.requestedByUserId as string,
            idempotencyKey: create.idempotencyKey as string,
            status: (create.status as string) ?? "PENDING",
            cellKeys: (create.cellKeys as string[]) ?? [],
            cellCount: (create.cellCount as number) ?? 0,
            signalsJson: create.signalsJson ?? null,
          };
          db.discoveries.push(row);
        }
        return pick(row, select);
      },
    ),
    update: vi.fn(async () => ({})),
    // Monthly cost-incurring map cap counter (queried only when a run is
    // cost-incurring). Reads the controllable db field; default 0 = under cap.
    count: vi.fn(async () => db.costIncurringMapCount),
  };

  // Agency billing state — read once in runDiscoveryAction for the free-market
  // lock (flag-gated, OFF in tests) + the monthly map cap. Free/no-plan here.
  const agency = {
    findUnique: vi.fn(
      async ({ select }: { select?: Record<string, boolean> }) => {
        const row = {
          plan: null as string | null,
          stripeStatus: null as string | null,
        };
        return pick(row, select);
      },
    ),
  };

  const creditLedger = {
    // No existing HOLD for a fresh discovery id.
    findFirst: vi.fn(async () => null),
  };

  const business = {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
    $transaction: undefined,
  };

  const client = {
    agencyMember,
    trackedLocation,
    costEstimate,
    discovery,
    agency,
    creditLedger,
    business,
    // buildPreview uses prisma.$transaction([...]) — resolve the array of promises.
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { default: client, Prisma: {} };
});

// Stub the cost/server seam. `authorizeEstimate` is stubbed so each test drives
// the gate branch DIRECTLY via the authorized quote's `netCredits` — decoupled
// from live discovery pricing (DISCOVERY_PRICE is zeroed today, so a real
// preflight nets $0; the WP5-8 gate must still be correct the moment pricing is
// re-enabled). `vi.hoisted` lifts the spies above the hoisted vi.mock factory.
const { holdCredits, authorizeEstimate } = vi.hoisted(() => ({
  holdCredits: vi.fn(async () => ({
    wallet: null,
    ledgerId: "led_1",
    held: 1,
  })),
  authorizeEstimate: vi.fn(),
}));

/** Point authorizeEstimate at an "ok" quote holding `netCredits` credits. */
function authorizedQuote(netCredits: number) {
  authorizeEstimate.mockResolvedValue({
    status: "authorized",
    estimateId: "est-1",
    result: { netUsd: netCredits * 0.05, netCredits },
  });
}

vi.mock("@/modules/cost/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/cost/server")>();
  return {
    ...actual,
    grantFreeTierIfNew: vi.fn(async () => {}),
    holdCredits,
    authorizeEstimate,
  };
});

// after() throws outside a request scope; the action already guards it, but
// stub kickDispatch to a no-op so nothing reaches the network.
vi.mock("@/modules/enrichment/kick-dispatch", () => ({
  kickDispatch: vi.fn(async () => {}),
}));

// ─── Import under test AFTER the mocks ──────────────────────────────────────

import { runDiscoveryAction } from "../actions";

beforeEach(() => {
  db.reset();
  SESSION = { user: { id: "user-1" } };
});
afterEach(() => vi.clearAllMocks());

/** Seed a QUOTED estimate whose stored scope has one cell (what the run
 *  reconstructs from, anti-tamper). `authorizeEstimate` is stubbed separately.
 *  `costIncurring` flags a run that will actually fetch (drives the map cap). */
function seedEstimate(costIncurring = false): string {
  const id = "est-1";
  db.estimates.push({
    id,
    agencyId: "agency-1",
    scopeKind: "discovery",
    scopeRefsJson: {
      kind: "discovery",
      cells: [{ cellKey: "medical_spa|miami|US" }],
      costIncurring,
    },
    enrichmentsJson: [],
    grossUsd: 0,
    freshHitUsd: 0,
    upperBoundUsd: 0,
    netUsd: 0,
    netCredits: 0,
    status: "QUOTED",
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    priceListVersion: "v1",
    createdByUserId: "user-1",
    consumedByRunId: null,
  });
  return id;
}

/** Make the sole caller a STAFF seat (same agency, same user). */
function makeStaff() {
  db.members = [
    {
      id: "mem-1",
      userId: "user-1",
      agencyId: "agency-1",
      role: "STAFF",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ];
}

describe("runDiscoveryAction · WP5-8 spend gate", () => {
  test("STAFF is DENIED when the authorized quote holds credits", async () => {
    const estimateId = seedEstimate();
    authorizedQuote(3); // stale/undiscovered cells → real credits held
    makeStaff();

    const r = await runDiscoveryAction({ estimateId });
    expect(r.status).toBe("forbidden");
    // Gate short-circuits BEFORE any hold — the wallet was never touched…
    expect(holdCredits).not.toHaveBeenCalled();
    // …and no Discovery row was created.
    expect(db.discoveries).toHaveLength(0);
  });

  test("STAFF is ALLOWED on a $0 all-fresh re-open (no hold)", async () => {
    const estimateId = seedEstimate();
    authorizedQuote(0); // every cell fresh → free read → no spend
    makeStaff();

    const r = await runDiscoveryAction({ estimateId });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // No credits held on a $0 re-open — STAFF re-opens their mapped market.
    expect(holdCredits).not.toHaveBeenCalled();
    expect(db.discoveries.find((d) => d.id === r.discoveryId)?.status).toBe(
      "PENDING",
    );
  });

  test("OWNER runs the credit-holding discovery fine", async () => {
    const estimateId = seedEstimate();
    authorizedQuote(3); // OWNER (default seed) may spend
    const r = await runDiscoveryAction({ estimateId });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(holdCredits).toHaveBeenCalledTimes(1);
    expect(db.discoveries.find((d) => d.id === r.discoveryId)?.status).toBe(
      "PENDING",
    );
    // Estimate consumed (single-use).
    expect(db.estimates.find((e) => e.id === estimateId)?.status).toBe(
      "CONSUMED",
    );
  });

  test("rejects an unauthenticated caller", async () => {
    SESSION = null;
    const r = await runDiscoveryAction({ estimateId: "est_x" });
    expect(r.status).toBe("unauthorized");
  });
});

describe("runDiscoveryAction · monthly cost-incurring map cap", () => {
  // Free agency (agency mock → {plan:null, stripeStatus:null}) → cap 5
  // (MONTHLY_MAP_CAP_FREE). The count is controlled via db.costIncurringMapCount.

  test("cost-incurring run at/over the cap is blocked (market_quota)", async () => {
    const estimateId = seedEstimate(true); // this run WILL fetch → gated
    authorizedQuote(0); // discovery is $0 to the user
    db.costIncurringMapCount = 5; // already at the free cap

    const r = await runDiscoveryAction({ estimateId });
    expect(r.status).toBe("market_quota");
    if (r.status !== "market_quota") return;
    expect(r.cap).toBe(5);
    // Blocked BEFORE any enqueue / hold.
    expect(db.discoveries).toHaveLength(0);
    expect(holdCredits).not.toHaveBeenCalled();
  });

  test("cost-incurring run under the cap proceeds", async () => {
    const estimateId = seedEstimate(true);
    authorizedQuote(0);
    db.costIncurringMapCount = 4; // under the free cap of 5

    const r = await runDiscoveryAction({ estimateId });
    expect(r.status).toBe("ok");
  });

  test("a $0 all-fresh re-open (not cost-incurring) is NEVER capped", async () => {
    const estimateId = seedEstimate(false); // free re-open of a mapped market
    authorizedQuote(0);
    db.costIncurringMapCount = 999; // way over any cap — must not matter

    const r = await runDiscoveryAction({ estimateId });
    expect(r.status).toBe("ok");
  });
});
