// WP5-8 · acceptPendingInvite — the seat-cap accept gate. Invariants:
//   - only the invited email can accept (forwarded links can't seat others)
//   - expired / unknown / already-consumed tokens are invalid
//   - the seat cap (maxSeats ?? plan default; Free state = 1) blocks the
//     create with "seat_limit", never a silent over-seat
//   - success creates AgencyMember(role) on the INVITING agency + stamps
//     acceptedAt; re-accepting as the same seated user is idempotent

import { beforeEach, describe, expect, test, vi } from "vitest";

interface FakeInvite {
  id: string;
  agencyId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  acceptedAt: Date | null;
}

const db = {
  invites: [] as FakeInvite[],
  members: [] as Array<{ agencyId: string; userId: string; role: string }>,
  agency: {
    id: "agency-1",
    maxSeats: null as number | null,
    plan: "SOLO",
    stripeStatus: null as string | null,
  },
  reset() {
    this.invites = [
      {
        id: "inv-1",
        agencyId: "agency-1",
        email: "va@team.com",
        role: "STAFF",
        token: "tok-valid",
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
      },
    ];
    this.members = [{ agencyId: "agency-1", userId: "owner-1", role: "OWNER" }];
    this.agency = {
      id: "agency-1",
      maxSeats: null,
      plan: "SOLO",
      stripeStatus: null,
    };
  },
};

vi.mock("@/lib/prisma", () => ({
  default: {
    agencyInvite: {
      findUnique: vi.fn(async ({ where }: { where: { token: string } }) => {
        const i = db.invites.find((x) => x.token === where.token);
        return i ? { ...i } : null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { acceptedAt: Date };
        }) => {
          const i = db.invites.find((x) => x.id === where.id);
          if (i) i.acceptedAt = data.acceptedAt;
          return { id: where.id };
        },
      ),
    },
    agencyMember: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { agencyId_userId: { agencyId: string; userId: string } };
        }) => {
          const m = db.members.find(
            (x) =>
              x.agencyId === where.agencyId_userId.agencyId &&
              x.userId === where.agencyId_userId.userId,
          );
          return m ? { id: `${m.agencyId}:${m.userId}` } : null;
        },
      ),
      count: vi.fn(
        async ({ where }: { where: { agencyId: string } }) =>
          db.members.filter((m) => m.agencyId === where.agencyId).length,
      ),
      upsert: vi.fn(
        async ({
          create,
        }: {
          create: { agencyId: string; userId: string; role: string };
        }) => {
          db.members.push({ ...create });
          return { id: `${create.agencyId}:${create.userId}` };
        },
      ),
    },
    agency: {
      findUnique: vi.fn(async () => ({
        maxSeats: db.agency.maxSeats,
        plan: db.agency.plan,
        stripeStatus: db.agency.stripeStatus,
      })),
    },
  },
  Prisma: {},
}));

import { acceptPendingInvite } from "../accept";
import {
  seatCapFor,
  FREE_SEAT_CAP,
  discoveryDepthCapFor,
  DISCOVERY_DEPTH_ENTRY,
  DISCOVERY_DEPTH_FULL,
} from "../seats";

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
});

describe("seatCapFor", () => {
  test("explicit maxSeats wins; Free state (no subscription) = 1", () => {
    expect(seatCapFor({ maxSeats: 7, plan: "SOLO", stripeStatus: null })).toBe(
      7,
    );
    expect(
      seatCapFor({ maxSeats: null, plan: "SOLO", stripeStatus: null }),
    ).toBe(FREE_SEAT_CAP);
    expect(
      seatCapFor({ maxSeats: null, plan: "GROWTH", stripeStatus: "active" }),
    ).toBe(3); // repriced 2026-07-09 (was 5)
    expect(
      seatCapFor({ maxSeats: null, plan: "BOUTIQUE", stripeStatus: "active" }),
    ).toBe(10); // repriced 2026-07-09 (was 15)
  });
});

describe("discoveryDepthCapFor (F-8 · COGS guard)", () => {
  test("Free state (no active subscription) maps shallow", () => {
    expect(discoveryDepthCapFor({ plan: "SOLO", stripeStatus: null })).toBe(
      DISCOVERY_DEPTH_ENTRY,
    );
    expect(
      discoveryDepthCapFor({ plan: "BOUTIQUE", stripeStatus: "canceled" }),
    ).toBe(DISCOVERY_DEPTH_ENTRY);
  });

  test("Starter ($19 · SOLO enum) maps shallow even when paid", () => {
    expect(discoveryDepthCapFor({ plan: "SOLO", stripeStatus: "active" })).toBe(
      DISCOVERY_DEPTH_ENTRY,
    );
  });

  test("Solo ($49 · AGENCY_PRO) and up map the full market", () => {
    for (const plan of ["AGENCY_PRO", "GROWTH", "BOUTIQUE"]) {
      expect(
        discoveryDepthCapFor({ plan, stripeStatus: "active" }),
        `${plan} should map full`,
      ).toBe(DISCOVERY_DEPTH_FULL);
    }
    // trialing / past_due still count as paid → full depth for Solo+.
    expect(
      discoveryDepthCapFor({ plan: "GROWTH", stripeStatus: "trialing" }),
    ).toBe(DISCOVERY_DEPTH_FULL);
  });

  test("the entry cap is strictly below the full cap", () => {
    expect(DISCOVERY_DEPTH_ENTRY).toBeLessThan(DISCOVERY_DEPTH_FULL);
  });
});

describe("acceptPendingInvite (WP5-8)", () => {
  test("Free-state cap of 1 blocks the second seat", async () => {
    // Owner already seated; free-state cap = 1 → the VA can't join.
    const r = await acceptPendingInvite("va-user", "va@team.com", "tok-valid");
    expect(r.status).toBe("seat_limit");
    expect(db.members).toHaveLength(1);
    // The invite stays consumable (retry after upgrade).
    expect(db.invites[0].acceptedAt).toBeNull();
  });

  test("open seat → member created on the INVITING agency with the invite role", async () => {
    db.agency.maxSeats = 5;
    const r = await acceptPendingInvite("va-user", "va@team.com", "tok-valid");
    expect(r).toEqual({ status: "accepted", agencyId: "agency-1" });
    const seated = db.members.find((m) => m.userId === "va-user");
    expect(seated).toEqual({
      agencyId: "agency-1",
      userId: "va-user",
      role: "STAFF",
    });
    expect(db.invites[0].acceptedAt).toBeInstanceOf(Date);
  });

  test("email mismatch — a forwarded link can't seat a different address", async () => {
    db.agency.maxSeats = 5;
    const r = await acceptPendingInvite(
      "mallory",
      "mallory@other.com",
      "tok-valid",
    );
    expect(r.status).toBe("email_mismatch");
    expect(db.members).toHaveLength(1);
  });

  test("expired / unknown / consumed tokens are invalid", async () => {
    db.agency.maxSeats = 5;
    db.invites[0].expiresAt = new Date(Date.now() - 1000);
    expect(
      (await acceptPendingInvite("va-user", "va@team.com", "tok-valid")).status,
    ).toBe("invalid");

    db.reset();
    db.agency.maxSeats = 5;
    expect(
      (await acceptPendingInvite("va-user", "va@team.com", "tok-nope")).status,
    ).toBe("invalid");

    // Consumed by someone else → a SECOND user can't ride the same token.
    db.invites[0].acceptedAt = new Date();
    expect(
      (await acceptPendingInvite("va-user-2", "va@team.com", "tok-valid"))
        .status,
    ).toBe("invalid");
  });

  test("re-accepting as the already-seated invitee is idempotent", async () => {
    db.agency.maxSeats = 5;
    await acceptPendingInvite("va-user", "va@team.com", "tok-valid");
    const again = await acceptPendingInvite(
      "va-user",
      "va@team.com",
      "tok-valid",
    );
    expect(again.status).toBe("accepted");
    expect(db.members.filter((m) => m.userId === "va-user")).toHaveLength(1);
  });
});
