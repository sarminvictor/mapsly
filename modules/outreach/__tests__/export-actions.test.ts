// T3/B1+B2 · touchGenPreflightAction — the generate-touches overlay's upfront
// context. Invariants:
//   - auth-gated (no session → unauthorized; no membership → forbidden)
//   - hasMailingAddress reflects Agency.mailingAddress (whitespace ≠ set)
//   - goalSignalKeys come from the agency's OWN discovery only (a foreign
//     discoveryId yields no keys), [] without a discoveryId

import { beforeEach, describe, expect, test, vi } from "vitest";

let SESSION: { user?: { id?: string } } | null = { user: { id: "user-1" } };
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => SESSION) }));

let MEMBER: { memberId: string; agencyId: string; role: string } | null = {
  memberId: "mem-1",
  agencyId: "agency-1",
  role: "OWNER",
};
vi.mock("@/modules/agency-portal/roles", () => ({
  callerAgencyMember: vi.fn(async () => MEMBER),
}));

const prismaMock = vi.hoisted(() => ({
  agency: { findUnique: vi.fn() },
  discovery: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

// Hermetic: the signal parser's SIG_META chain is out of scope here.
vi.mock("@/modules/agency-portal/discover/discovery-signals", () => ({
  activeSignalsFromJson: (raw: unknown) =>
    Array.isArray((raw as { signals?: { key: string }[] } | null)?.signals)
      ? (raw as { signals: { key: string }[] }).signals
      : [],
}));

import { touchGenPreflightAction } from "../export-actions";

beforeEach(() => {
  vi.clearAllMocks();
  SESSION = { user: { id: "user-1" } };
  MEMBER = { memberId: "mem-1", agencyId: "agency-1", role: "OWNER" };
  prismaMock.agency.findUnique.mockResolvedValue({ mailingAddress: null });
  prismaMock.discovery.findFirst.mockResolvedValue(null);
});

describe("touchGenPreflightAction", () => {
  test("unauthorized without a session", async () => {
    SESSION = null;
    expect(await touchGenPreflightAction({})).toEqual({
      status: "unauthorized",
    });
  });

  test("forbidden without an agency membership", async () => {
    MEMBER = null;
    expect(await touchGenPreflightAction({})).toEqual({ status: "forbidden" });
  });

  test("hasMailingAddress false for null AND whitespace-only addresses", async () => {
    prismaMock.agency.findUnique.mockResolvedValue({ mailingAddress: "   " });
    const r = await touchGenPreflightAction({});
    expect(r).toEqual({
      status: "ok",
      hasMailingAddress: false,
      goalSignalKeys: [],
    });
  });

  test("returns the discovery's goal-signal keys, agency-scoped", async () => {
    prismaMock.agency.findUnique.mockResolvedValue({
      mailingAddress: "1 Main St, Miami, FL",
    });
    prismaMock.discovery.findFirst.mockResolvedValue({
      signalsJson: { signals: [{ key: "slow_site" }, { key: "no_booking" }] },
    });
    const r = await touchGenPreflightAction({ discoveryId: "disc-1" });
    expect(r).toEqual({
      status: "ok",
      hasMailingAddress: true,
      goalSignalKeys: ["slow_site", "no_booking"],
    });
    // The lookup is pinned to the caller's agency (foreign ids yield nothing).
    expect(prismaMock.discovery.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "disc-1", agencyId: "agency-1" },
      }),
    );
  });

  test("empty goalSignalKeys without a discoveryId (cross-discovery surface)", async () => {
    const r = await touchGenPreflightAction({});
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.goalSignalKeys).toEqual([]);
      expect(prismaMock.discovery.findFirst).not.toHaveBeenCalled();
    }
  });
});
