// FT-2 · searchIndexLeadsAction integration tests. Mocks the seams (auth,
// prisma, cost/server wallet+billing, signal-eval) and asserts the money +
// selection invariants after the 2026-07-08 owner decisions:
//   - charge ONLY for delivered leads (settle to the inserted count)
//   - the WALLET is the only ceiling (no separate free cap — Q3)
//   - STRICT full-match: EVERY selected signal must be confirmed TRUE; a signal
//     with no data (null verdict) EXCLUDES the business (Q1)
//   - we match on the FULL selected set (basic AND paid) — nothing dropped (Q1)
//   - agency-wide DEDUP: a business the agency already holds is never re-delivered
//   - the spend is recorded as an EnrichmentRun so the research card reads it
//   - a CONTACTS entitlement is minted per delivered lead

import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as { user?: { id?: string } } | null,
  state: {
    WALLET: 1000,
    MATCHING: new Set<string>(),
    HELD: [] as { businessId: string }[],
    PERSIGNAL: new Map<string, Record<string, boolean | null>>(),
    lastSignalCount: -1,
  },
  prisma: {
    agencyMember: { findFirst: vi.fn() },
    business: { findMany: vi.fn() },
    discovery: { create: vi.fn() },
    list: { create: vi.fn() },
    lead: { findMany: vi.fn(), createMany: vi.fn() },
    enrichmentRun: { create: vi.fn() },
    agencyEntitlement: { createMany: vi.fn() },
  },
  holdCredits: vi.fn(async () => ({ ok: true })),
  reconcile: vi.fn(async () => ({ charged: 0, refunded: 0 })),
  refundHold: vi.fn(async () => ({ charged: 0, refunded: 0 })),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/lib/prisma", () => ({ default: h.prisma, Prisma: {} }));
vi.mock("@/modules/cost/server", () => ({
  getOrCreateWallet: vi.fn(async () => ({ availableCredits: h.state.WALLET })),
  holdCredits: h.holdCredits,
  reconcileRunCredits: h.reconcile,
  refundHold: h.refundHold,
  grantFreeTierIfNew: vi.fn(async () => undefined),
  WalletError: class WalletError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));
vi.mock("@/modules/cost/flags", () => ({
  entitlementBillingEnabled: () => true,
}));
vi.mock("@/modules/agency-portal/discover/signal-eval", () => ({
  hydrateBusinessForSignals: vi.fn(async (ids: string[]) => {
    const m = new Map<string, object>();
    for (const id of ids) m.set(id, { __id: id });
    return m;
  }),
  resolveMatches: vi.fn(
    (signals: { key: string }[], biz: { __id?: string }) => {
      h.state.lastSignalCount = signals.length;
      const id = biz.__id ?? "";
      const override = h.state.PERSIGNAL.get(id);
      const perSignal: Record<string, boolean | null> = {};
      let matchedCount = 0;
      let applicableCount = 0;
      for (const s of signals) {
        const v = override
          ? (override[s.key] ?? null)
          : h.state.MATCHING.has(id);
        perSignal[s.key] = v;
        if (v === null) continue;
        applicableCount += 1;
        if (v) matchedCount += 1;
      }
      return {
        matchedCount,
        applicableCount,
        matchPct: applicableCount ? matchedCount / applicableCount : 0,
        perSignal,
      };
    },
  ),
}));
vi.mock("@/modules/agency-portal/discover/discovery-signals", () => ({
  activeSignalsFromJson: (raw: unknown) => (Array.isArray(raw) ? raw : []),
  // roadmap signals (key starts with "roadmap_") are non-evaluable → excluded
  // from the strict match gate, mirroring the real isEvaluableSignalKey.
  isEvaluableSignalKey: (k: string) => !k.startsWith("roadmap_"),
}));

import { searchIndexLeadsAction } from "../search-index-actions";

function seedBusinesses(ids: string[]) {
  h.prisma.business.findMany.mockReset();
  h.prisma.business.findMany
    // scan batch 1 → the ids; batch 2 → empty (scan ends); cellRows → empty.
    .mockResolvedValueOnce(ids.map((id) => ({ id })))
    .mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { user: { id: "u1" } };
  h.state.WALLET = 1000;
  h.state.MATCHING = new Set();
  h.state.HELD = [];
  h.state.PERSIGNAL = new Map();
  h.state.lastSignalCount = -1;
  h.prisma.agencyMember.findFirst.mockResolvedValue({
    id: "m1",
    agencyId: "a1",
  });
  h.prisma.lead.findMany.mockImplementation(async () => h.state.HELD);
  h.prisma.discovery.create.mockResolvedValue({ id: "disc1" });
  h.prisma.list.create.mockResolvedValue({ id: "list1" });
  h.prisma.lead.createMany.mockImplementation(
    async ({ data }: { data: unknown[] }) => ({ count: data.length }),
  );
  h.prisma.enrichmentRun.create.mockResolvedValue({ id: "run1" });
  h.prisma.agencyEntitlement.createMany.mockResolvedValue({ count: 0 });
});

describe("searchIndexLeadsAction · FT-2 invariants", () => {
  test("charges ONLY for delivered leads (30 asked, 24 match → 24 billed)", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `b${i}`);
    h.state.MATCHING = new Set(ids.slice(0, 24));
    seedBusinesses(ids);

    const res = await searchIndexLeadsAction({
      signalsJson: [{ key: "has_website" }],
      count: 30,
    });

    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.delivered).toBe(24);
    // settle via the never-throw reconcile path (actual = delivered, hadProgress).
    expect(h.reconcile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ actualCredits: 24, hadProgress: true }),
    );
    expect(h.holdCredits).toHaveBeenCalledWith("a1", 24, expect.any(String));
  });

  test("roadmap (non-evaluable) signals are excluded from the strict gate — never zero the search", async () => {
    seedBusinesses(["b0"]);
    // b0 matches the real signal; the roadmap signal would be null forever and,
    // if required, would make every result empty. It must be filtered out.
    h.state.MATCHING = new Set(["b0"]);
    const res = await searchIndexLeadsAction({
      signalsJson: [{ key: "has_website" }, { key: "roadmap_multi_location" }],
      count: 5,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.delivered).toBe(1);
    expect(h.state.lastSignalCount).toBe(1); // roadmap dropped before matching
  });

  test("no free cap — the wallet is the only ceiling (80 match, 1000 credits → 80)", async () => {
    const ids = Array.from({ length: 80 }, (_, i) => `b${i}`);
    h.state.MATCHING = new Set(ids);
    seedBusinesses(ids);
    const res = await searchIndexLeadsAction({
      signalsJson: [{ key: "has_website" }],
      count: 80,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.delivered).toBe(80);
  });

  test("wallet is the hard ceiling (wants 50 but only 10 credits)", async () => {
    h.state.WALLET = 10;
    const ids = Array.from({ length: 40 }, (_, i) => `b${i}`);
    h.state.MATCHING = new Set(ids);
    seedBusinesses(ids);
    const res = await searchIndexLeadsAction({
      signalsJson: [{ key: "has_website" }],
      count: 50,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.delivered).toBe(10);
  });

  test("zero credits → insufficient_credits, no charge", async () => {
    h.state.WALLET = 0;
    const res = await searchIndexLeadsAction({ signalsJson: [], count: 10 });
    expect(res.status).toBe("insufficient_credits");
    expect(h.holdCredits).not.toHaveBeenCalled();
  });

  test("matches on the FULL selected set — paid signals are NOT dropped (Q1)", async () => {
    const ids = ["b0"];
    h.state.MATCHING = new Set(ids);
    seedBusinesses(ids);
    // overdue_redesign is lighthouse-gated; it must STILL be passed to the matcher.
    await searchIndexLeadsAction({
      signalsJson: [{ key: "has_website" }, { key: "overdue_redesign" }],
      count: 1,
    });
    expect(h.state.lastSignalCount).toBe(2);
  });

  test("STRICT full-match — a null verdict on any selected signal EXCLUDES the lead (Q1)", async () => {
    seedBusinesses(["b0", "b1"]);
    // b0 fully matches; b1 has the paid signal null (no data) → excluded.
    h.state.PERSIGNAL.set("b0", { has_website: true, overdue_redesign: true });
    h.state.PERSIGNAL.set("b1", { has_website: true, overdue_redesign: null });
    const res = await searchIndexLeadsAction({
      signalsJson: [{ key: "has_website" }, { key: "overdue_redesign" }],
      count: 5,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.delivered).toBe(1);
  });

  test("agency-wide dedup — a business the agency already holds is never re-delivered", async () => {
    const ids = ["b0", "b1", "b2"];
    h.state.MATCHING = new Set(ids);
    h.state.HELD = [{ businessId: "b1" }]; // already owned
    seedBusinesses(ids);
    const res = await searchIndexLeadsAction({
      signalsJson: [{ key: "has_website" }],
      count: 5,
    });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.delivered).toBe(2); // b0, b2 (b1 skipped)
  });

  test("records the spend as an EnrichmentRun so the research card reads it", async () => {
    const ids = ["b0", "b1"];
    h.state.MATCHING = new Set(ids);
    seedBusinesses(ids);
    await searchIndexLeadsAction({
      signalsJson: [{ key: "has_website" }],
      count: 2,
    });
    expect(h.prisma.enrichmentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agencyId: "a1",
          discoveryId: "disc1",
          scopeKind: "search",
          status: "OK",
          creditsCharged: 2,
        }),
      }),
    );
  });

  test("mints a CONTACTS entitlement per delivered lead", async () => {
    const ids = ["b0", "b1"];
    h.state.MATCHING = new Set(ids);
    seedBusinesses(ids);
    await searchIndexLeadsAction({
      signalsJson: [{ key: "has_website" }],
      count: 2,
    });
    expect(h.prisma.agencyEntitlement.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ agencyId: "a1", family: "CONTACTS" }),
        ]),
        skipDuplicates: true,
      }),
    );
  });
});
