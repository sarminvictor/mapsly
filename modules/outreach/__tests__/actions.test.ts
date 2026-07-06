// WP5-1 · generateTouchpointsAction — selection-scoped generation. Invariants:
//   - spend-gated (STAFF / non-member → forbidden)
//   - explicit businessIds are gated through the agency's discovered cells
//   - already-drafted businesses (agency-scoped read) are skipped
//   - credits: hold ceil(targets×steps / 10) → settle the actual; an
//     insufficient wallet surfaces as `insufficient_credits`, not an error

import { beforeEach, describe, expect, test, vi } from "vitest";

// ─── Mockable session ────────────────────────────────────────────────────────

let SESSION: { user?: { id?: string } } | null = { user: { id: "user-1" } };
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => SESSION) }));

// ─── Role gate seam ──────────────────────────────────────────────────────────

let SPEND_MEMBER: { memberId: string; agencyId: string; role: string } | null =
  { memberId: "mem-1", agencyId: "agency-1", role: "OWNER" };
vi.mock("@/modules/agency-portal/roles", () => ({
  requireSpendMember: vi.fn(async () => SPEND_MEMBER),
  callerAgencyMember: vi.fn(async () => SPEND_MEMBER),
  canSpendCredits: (r: string) => r === "OWNER" || r === "ADMIN",
}));

// ─── Wallet seam ─────────────────────────────────────────────────────────────

const FakeWalletError = vi.hoisted(
  () =>
    class FakeWalletError extends Error {
      code: string;
      constructor(code: string) {
        super(code);
        this.code = code;
      }
    },
);
const wallet = vi.hoisted(() => ({
  grantFreeTierIfNew: vi.fn(async () => undefined),
  holdCredits: vi.fn(async () => ({ held: 0 })),
  refundHold: vi.fn(async () => ({ charged: 0, refunded: 0 })),
  settleRun: vi.fn(async (_runId: string, actual: number) => ({
    charged: actual,
    refunded: 0,
  })),
}));
vi.mock("@/modules/cost/server", () => ({
  ...wallet,
  WalletError: FakeWalletError,
}));

// ─── Generator seam ──────────────────────────────────────────────────────────

const generator = vi.hoisted(() => ({
  // TM-1 · returns { touches, skippedNoAddress } (not a bare array).
  generateTouchesForLeads: vi.fn(
    async (ids: string[], opts: { sequenceLength?: number }) => ({
      touches: ids.flatMap((businessId) =>
        Array.from({ length: opts.sequenceLength ?? 1 }, (_, i) => ({
          businessId,
          draftId: `d-${businessId}-${i + 1}`,
        })),
      ),
      skippedNoAddress: 0,
    }),
  ),
  gatherTouchSignals: vi.fn(),
}));
vi.mock("@/modules/outreach/generate", () => generator);

// ─── Prisma seam ─────────────────────────────────────────────────────────────

const prismaMock = vi.hoisted(() => ({
  discovery: { findMany: vi.fn() },
  business: { findMany: vi.fn() },
  outreachDraft: { findMany: vi.fn(), update: vi.fn() },
  agency: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

import { generateTouchpointsAction } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  SESSION = { user: { id: "user-1" } };
  SPEND_MEMBER = { memberId: "mem-1", agencyId: "agency-1", role: "OWNER" };
  prismaMock.discovery.findMany.mockResolvedValue([
    { cellKeys: ["med_spa|miami|US"] },
  ]);
  prismaMock.agency.findUnique.mockResolvedValue({
    mailingAddress: "1 Main St, Miami FL",
  });
  prismaMock.outreachDraft.findMany.mockResolvedValue([]);
});

describe("generateTouchpointsAction · selection scope (WP5-1)", () => {
  test("STAFF (no spend role) → forbidden, nothing generated or held", async () => {
    SPEND_MEMBER = null;
    const r = await generateTouchpointsAction({
      sellingWhat: "marketing",
      channel: "email",
      businessIds: ["b1"],
    });
    expect(r.status).toBe("forbidden");
    expect(generator.generateTouchesForLeads).not.toHaveBeenCalled();
    expect(wallet.holdCredits).not.toHaveBeenCalled();
  });

  test("explicit ids are cell-gated + already-drafted skipped; credits hold→settle", async () => {
    // b1+b2 pass the cell gate (b3 is another agency's — the where filter
    // excludes it); b2 already has a draft for THIS agency.
    prismaMock.business.findMany.mockResolvedValue([
      { id: "b1" },
      { id: "b2" },
    ]);
    prismaMock.outreachDraft.findMany.mockResolvedValue([{ businessId: "b2" }]);

    const r = await generateTouchpointsAction({
      sellingWhat: "marketing",
      channel: "email",
      businessIds: ["b1", "b2", "b3"],
      sequenceLength: 2,
      tone: "warm",
    });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // Only b1 generated (b2 skipped as drafted), 2 steps → 2 drafts.
    expect(generator.generateTouchesForLeads).toHaveBeenCalledWith(
      ["b1"],
      expect.objectContaining({
        agencyId: "agency-1",
        sequenceLength: 2,
        tone: "warm",
      }),
    );
    expect(r.generated).toBe(2);
    expect(r.skippedExisting).toBe(1);
    // 1 business × 2 steps = 2 touches → ceil(2×10/100) = 1 credit.
    expect(wallet.holdCredits).toHaveBeenCalledWith(
      "agency-1",
      1,
      expect.stringMatching(/^touchgen:/),
    );
    expect(wallet.settleRun).toHaveBeenCalledWith(
      expect.stringMatching(/^touchgen:/),
      1,
    );
    expect(r.creditsCharged).toBe(1);
    // The cell gate rode the business query.
    const where = prismaMock.business.findMany.mock.calls[0][0].where;
    expect(where.cellKey).toEqual({ in: ["med_spa|miami|US"] });
    expect(where.id).toEqual({ in: ["b1", "b2", "b3"] });
  });

  test("insufficient wallet → insufficient_credits with the needed amount", async () => {
    prismaMock.business.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ id: `b${i}` })),
    );
    wallet.holdCredits.mockRejectedValueOnce(
      new FakeWalletError("insufficient_credits"),
    );

    const r = await generateTouchpointsAction({
      sellingWhat: "marketing",
      channel: "email",
      businessIds: Array.from({ length: 20 }, (_, i) => `b${i}`),
      sequenceLength: 3,
    });

    // 20 × 3 = 60 touches → ceil(60×10/100) = 6 credits.
    expect(r).toEqual({ status: "insufficient_credits", creditsNeeded: 6 });
    expect(generator.generateTouchesForLeads).not.toHaveBeenCalled();
  });

  test("generation failure refunds the hold", async () => {
    prismaMock.business.findMany.mockResolvedValue([{ id: "b1" }]);
    generator.generateTouchesForLeads.mockRejectedValueOnce(new Error("boom"));

    const r = await generateTouchpointsAction({
      sellingWhat: "marketing",
      channel: "email",
      businessIds: ["b1"],
    });

    expect(r.status).toBe("error");
    expect(wallet.refundHold).toHaveBeenCalledWith(
      expect.stringMatching(/^touchgen:/),
    );
    expect(wallet.settleRun).not.toHaveBeenCalled();
  });
});
