// WP5-9 · setLeadStatusBulkAction — one transaction for an N-lead sweep.
// Invariants:
//   - leads in the caller's agency update via ONE updateMany (with the
//     closed-loop stamp), not N per-id calls
//   - misses + discoveryId lazy-create into the discovery's raw list
//     (createMany skipDuplicates + updateMany for pre-existing rows)
//   - unknown ids come back in failedIds; cross-agency leads never update
//   - auth + membership gate the action

import { beforeEach, describe, expect, test, vi } from "vitest";

let SESSION: { user?: { id?: string } } | null = { user: { id: "user-1" } };
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => SESSION) }));

// ─── In-memory prisma seam ──────────────────────────────────────────────────

interface FakeLead {
  id: string;
  listId: string;
  agencyId: string;
  businessId: string;
  status: string;
  statusChangedAt: Date | null;
  contactedAt: Date | null;
  wonAt: Date | null;
}

const db = {
  members: [{ id: "mem-1", userId: "user-1", agencyId: "agency-1" }],
  discoveries: [
    { id: "disc-1", agencyId: "agency-1", cellKeys: ["med_spa|miami|US"] },
  ],
  lists: [] as Array<{
    id: string;
    agencyId: string;
    discoveryId: string | null;
    isRaw: boolean;
  }>,
  leads: [] as FakeLead[],
  businesses: [{ id: "raw-1" }, { id: "raw-2" }],
  seq: 0,
  id(p: string) {
    this.seq += 1;
    return `${p}_${this.seq}`;
  },
  reset() {
    this.members = [{ id: "mem-1", userId: "user-1", agencyId: "agency-1" }];
    this.discoveries = [
      { id: "disc-1", agencyId: "agency-1", cellKeys: ["med_spa|miami|US"] },
    ];
    this.lists = [];
    this.leads = [
      lead("lead-1", "agency-1"),
      lead("lead-2", "agency-1"),
      lead("lead-other", "agency-2"), // another agency's lead
    ];
    this.businesses = [{ id: "raw-1" }, { id: "raw-2" }];
    this.seq = 0;
  },
};

function lead(id: string, agencyId: string): FakeLead {
  return {
    id,
    listId: "list-x",
    agencyId,
    businessId: `biz-${id}`,
    status: "NEW",
    statusChangedAt: null,
    contactedAt: null,
    wonAt: null,
  };
}

vi.mock("@/lib/prisma", () => {
  const agencyMember = {
    findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => {
      const m = db.members.find((x) => x.userId === where.userId);
      return m ? { id: m.id, agencyId: m.agencyId } : null;
    }),
  };
  const discovery = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const d = db.discoveries.find((x) => x.id === where.id);
      return d ? { id: d.id, agencyId: d.agencyId } : null;
    }),
  };
  const list = {
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: { agencyId: string; discoveryId: string; isRaw: boolean };
      }) => {
        const l = db.lists.find(
          (x) =>
            x.agencyId === where.agencyId &&
            x.discoveryId === where.discoveryId &&
            x.isRaw === where.isRaw,
        );
        return l ? { id: l.id } : null;
      },
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: db.id("list"),
        agencyId: data.agencyId as string,
        discoveryId: (data.discoveryId as string) ?? null,
        isRaw: (data.isRaw as boolean) ?? false,
      };
      db.lists.push(row);
      return { id: row.id };
    }),
  };
  const business = {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      db.businesses.filter((b) => where.id.in.includes(b.id)),
    ),
  };
  const leadModel = {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: { id: { in: string[] }; agencyId: string };
      }) =>
        db.leads
          .filter(
            (l) => where.id.in.includes(l.id) && l.agencyId === where.agencyId,
          )
          .map((l) => ({ id: l.id })),
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: {
          id?: { in: string[] };
          listId?: string;
          businessId?: { in: string[] };
        };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const l of db.leads) {
          const byId = where.id ? where.id.in.includes(l.id) : true;
          const byList = where.listId ? l.listId === where.listId : true;
          const byBiz = where.businessId
            ? where.businessId.in.includes(l.businessId)
            : true;
          if (byId && byList && byBiz) {
            Object.assign(l, data);
            count += 1;
          }
        }
        return { count };
      },
    ),
    createMany: vi.fn(
      async ({
        data,
        skipDuplicates,
      }: {
        data: Array<Record<string, unknown>>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const d of data) {
          const exists = db.leads.some(
            (l) => l.listId === d.listId && l.businessId === d.businessId,
          );
          if (exists && skipDuplicates) continue;
          db.leads.push({
            id: db.id("lead"),
            listId: d.listId as string,
            agencyId: d.agencyId as string,
            businessId: d.businessId as string,
            status: d.status as string,
            statusChangedAt: (d.statusChangedAt as Date) ?? null,
            contactedAt: (d.contactedAt as Date) ?? null,
            wonAt: (d.wonAt as Date) ?? null,
          });
          count += 1;
        }
        return { count };
      },
    ),
  };
  return {
    default: {
      agencyMember,
      discovery,
      list,
      business,
      lead: leadModel,
      // The action passes an array of already-invoked mock promises.
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
    Prisma: {},
  };
});

import { setLeadStatusBulkAction } from "../save-list-actions";
import prisma from "@/lib/prisma";

beforeEach(() => {
  db.reset();
  SESSION = { user: { id: "user-1" } };
  vi.clearAllMocks();
});

describe("setLeadStatusBulkAction (WP5-9)", () => {
  test("updates N agency leads in one updateMany with the closed-loop stamp", async () => {
    const r = await setLeadStatusBulkAction({
      leadIds: ["lead-1", "lead-2"],
      status: "CONTACTED",
    });
    expect(r).toEqual({ status: "ok", updated: 2, failedIds: [] });

    const l1 = db.leads.find((l) => l.id === "lead-1")!;
    const l2 = db.leads.find((l) => l.id === "lead-2")!;
    expect(l1.status).toBe("CONTACTED");
    expect(l2.status).toBe("CONTACTED");
    expect(l1.contactedAt).toBeInstanceOf(Date);
    // ONE updateMany for the batch — not one call per id.
    expect(
      (
        prisma as unknown as {
          lead: { updateMany: { mock: { calls: unknown[] } } };
        }
      ).lead.updateMany.mock.calls,
    ).toHaveLength(1);
  });

  test("cross-agency lead never updates and reads as failed", async () => {
    const r = await setLeadStatusBulkAction({
      leadIds: ["lead-1", "lead-other"],
      status: "WON",
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.updated).toBe(1);
    expect(r.failedIds).toEqual(["lead-other"]);
    expect(db.leads.find((l) => l.id === "lead-other")!.status).toBe("NEW");
  });

  test("bare businessIds + discoveryId lazy-create into the raw list", async () => {
    const r = await setLeadStatusBulkAction({
      leadIds: ["raw-1", "raw-2", "ghost-1"],
      status: "CONTACTED",
      discoveryId: "disc-1",
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.updated).toBe(2);
    expect(r.failedIds).toEqual(["ghost-1"]);

    // A raw list was created for the discovery + two Leads in it.
    const rawList = db.lists.find((l) => l.isRaw && l.discoveryId === "disc-1");
    expect(rawList).toBeTruthy();
    const created = db.leads.filter((l) => l.listId === rawList!.id);
    expect(created.map((l) => l.businessId).sort()).toEqual(["raw-1", "raw-2"]);
    expect(created.every((l) => l.status === "CONTACTED")).toBe(true);
  });

  test("no session → unauthorized · no membership → forbidden", async () => {
    SESSION = null;
    expect(
      (
        await setLeadStatusBulkAction({
          leadIds: ["lead-1"],
          status: "WON",
        })
      ).status,
    ).toBe("unauthorized");

    SESSION = { user: { id: "stranger" } };
    expect(
      (
        await setLeadStatusBulkAction({
          leadIds: ["lead-1"],
          status: "WON",
        })
      ).status,
    ).toBe("forbidden");
  });
});
