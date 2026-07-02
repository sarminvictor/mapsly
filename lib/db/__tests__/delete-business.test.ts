// WP9-2 · proves deleteBusinessDeep drops every plain-FK child (no DB cascade)
// plus the businesses, and chunks large id sets.

import { describe, expect, it, vi } from "vitest";

import { deleteBusinessDeep } from "../delete-business";

const CHILD_MODELS = [
  "contact",
  "enrichmentJob",
  "businessTech",
  "playbookFinding",
  "lighthouseOpportunity",
  "businessLicense",
  "businessEnrichment",
  "enrichmentStageRun",
] as const;

function makeMockPrisma() {
  const calls: Record<string, unknown[]> = {};
  const model = (name: string) => {
    calls[name] = [];
    return {
      deleteMany: vi.fn(async (arg: unknown) => {
        calls[name].push(arg);
        return { count: 1 };
      }),
    };
  };
  const prisma: Record<string, unknown> = { business: model("business") };
  for (const m of CHILD_MODELS) prisma[m] = model(m);
  // $transaction runs the array of thenables (deleteMany already invoked).
  prisma.$transaction = vi.fn((ops: Promise<unknown>[]) => Promise.all(ops));
  return { prisma, calls };
}

describe("deleteBusinessDeep", () => {
  it("no-ops on empty input (no queries)", async () => {
    const { prisma, calls } = makeMockPrisma();
    const res = await deleteBusinessDeep(prisma as never, []);
    expect(res.businesses).toBe(0);
    expect(calls.business).toHaveLength(0);
    for (const m of CHILD_MODELS) expect(calls[m]).toHaveLength(0);
  });

  it("deletes all 8 plain-FK children + businesses by businessId", async () => {
    const { prisma, calls } = makeMockPrisma();
    const res = await deleteBusinessDeep(prisma as never, ["b1", "b2"]);
    // Every plain-FK child was filtered by businessId in [b1,b2].
    for (const m of CHILD_MODELS) {
      expect(calls[m]).toHaveLength(1);
      expect(calls[m][0]).toEqual({
        where: { businessId: { in: ["b1", "b2"] } },
      });
    }
    // Businesses deleted by id (declared-relation children cascade).
    expect(calls.business[0]).toEqual({ where: { id: { in: ["b1", "b2"] } } });
    expect(res.businesses).toBe(1);
    expect(res.contacts).toBe(1);
    expect(res.enrichmentStageRuns).toBe(1);
  });

  it("chunks a >1000 id set into separate transactions", async () => {
    const { prisma } = makeMockPrisma();
    const ids = Array.from({ length: 2500 }, (_, i) => `b${i}`);
    await deleteBusinessDeep(prisma as never, ids);
    // 2500 / 1000 = 3 chunks → 3 transactions.
    expect(
      (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(3);
  });
});
