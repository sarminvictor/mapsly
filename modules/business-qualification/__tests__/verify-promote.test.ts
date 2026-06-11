/**
 * verifyAndPromoteCellEmails · the qualification→outreach bridge.
 *
 * Invariants:
 *  1. deliverable AND inconclusive verdicts promote (Business.email +
 *     emailVerifiedAt) — mirroring the monthly email-verification
 *     cron's keep semantics.
 *  2. undeliverable flags `email_undeliverable` and does NOT promote —
 *     hard bounces must never reach the cold sender.
 *  3. Probe errors leave the row untouched (retryable) and are tallied.
 *  4. Eligibility excludes already-promoted, already-flagged and
 *     non-QUALIFIED rows; `remaining` reports what's left.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  trackedLocation: { findUnique: vi.fn() },
  business: {
    findMany: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

const verifyMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/email-verify", () => ({ smtpVerifyEmail: verifyMock }));

import { verifyAndPromoteCellEmails } from "../verify-promote";

const CELL = {
  id: "cell_1",
  city: "Miami",
  country: "US",
  lat: 25.7617,
  lng: -80.1918,
  radiusKm: 10,
  category: { dataforseoId: "medical_spa" },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.trackedLocation.findUnique.mockResolvedValue(CELL);
  prismaMock.business.count.mockResolvedValue(0);
  prismaMock.business.update.mockResolvedValue({});
});

describe("verifyAndPromoteCellEmails", () => {
  test("promotes deliverable + inconclusive, flags undeliverable, tallies errors", async () => {
    prismaMock.business.findMany.mockResolvedValue([
      { id: "b1", emailDiscovered: "a@spa1.com", qualificationFlags: [] },
      { id: "b2", emailDiscovered: "b@spa2.com", qualificationFlags: [] },
      {
        id: "b3",
        emailDiscovered: "c@spa3.com",
        qualificationFlags: ["ai_attempted"],
      },
      { id: "b4", emailDiscovered: "d@spa4.com", qualificationFlags: [] },
    ]);
    verifyMock.mockImplementation(async ({ email }: { email: string }) => {
      if (email === "a@spa1.com") return { verdict: "deliverable" };
      if (email === "b@spa2.com") return { verdict: "inconclusive" };
      if (email === "c@spa3.com") return { verdict: "undeliverable" };
      throw new Error("MX timeout");
    });
    prismaMock.business.count.mockResolvedValue(7);

    const result = await verifyAndPromoteCellEmails({
      trackedLocationId: "cell_1",
    });

    expect(result).toMatchObject({
      processed: 4,
      promotedDeliverable: 1,
      promotedInconclusive: 1,
      undeliverable: 1,
      errors: 1,
      remaining: 7,
    });

    // Promotions write email + emailVerifiedAt.
    const updates = prismaMock.business.update.mock.calls.map((c) => c[0]);
    const promoted = updates.filter((u) => u.data.email);
    expect(promoted.map((u) => u.where.id).sort()).toEqual(["b1", "b2"]);
    for (const u of promoted) {
      expect(u.data.emailVerifiedAt).toBeInstanceOf(Date);
    }
    // The bounce got the flag (preserving existing flags) and NO email.
    const flagged = updates.find((u) => u.where.id === "b3")!;
    expect(flagged.data.email).toBeUndefined();
    expect(flagged.data.qualificationFlags).toEqual([
      "ai_attempted",
      "email_undeliverable",
    ]);
    // The errored row was never written.
    expect(updates.some((u) => u.where.id === "b4")).toBe(false);
  });

  test("eligibility where-clause: QUALIFIED, discovered, unpromoted, unflagged", async () => {
    prismaMock.business.findMany.mockResolvedValue([]);

    await verifyAndPromoteCellEmails({ trackedLocationId: "cell_1" });

    const where = prismaMock.business.findMany.mock.calls[0]![0].where;
    expect(where.qualificationStatus).toBe("QUALIFIED");
    expect(where.emailDiscovered).toEqual({ not: null });
    expect(where.email).toBeNull();
    expect(where.NOT).toEqual({
      qualificationFlags: { has: "email_undeliverable" },
    });
    // Geo membership applied.
    expect(where.categoryIds).toEqual({ has: "medical_spa" });
  });
});
