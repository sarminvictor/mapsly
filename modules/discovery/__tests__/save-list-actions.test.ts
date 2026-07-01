// Unit tests for the save-as-list + lead-status server actions (demand flow).
//
// Mocks `@/lib/auth` (the session) and `@/lib/prisma` with an in-memory store
// covering the models the actions touch (AgencyMember, Discovery, List, Lead).
// The invariants under test:
//   - saveAsListAction creates a List scoped to the caller's agency + member,
//     with serviceType=CUSTOM, filterJson={}, discoveryId set, isRaw=false, and
//     category/metro seeded from the discovery's first cellKey; Lead rows are
//     written with status NEW + the list's agencyId, deduped.
//   - auth + agency membership + discovery agency-scope gate the action, and Zod
//     rejects empty selections / over-cap / blank names.
//   - setLeadStatusAction flips status + stamps the matching closed-loop time,
//     gated by the lead's own agencyId.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── Mockable session ───────────────────────────────────────────────────────

let SESSION: { user?: { id?: string } } | null = { user: { id: "user-1" } };

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => SESSION),
}));

// ─── In-memory prisma seam ──────────────────────────────────────────────────

interface FakeMember {
  id: string;
  userId: string;
  agencyId: string;
}
interface FakeDiscovery {
  id: string;
  agencyId: string;
  cellKeys: string[];
}
interface FakeList {
  id: string;
  agencyId: string;
  ownerMemberId: string;
  name: string;
  serviceType: string;
  filterJson: unknown;
  discoveryId: string | null;
  isRaw: boolean;
  category: string | null;
  metro: string | null;
}
interface FakeLead {
  id: string;
  listId: string;
  agencyId: string;
  businessId: string;
  status: string;
  statusChangedAt: Date;
  contactedAt: Date | null;
  repliedAt: Date | null;
  wonAt: Date | null;
  lostAt: Date | null;
}

interface FakeBusiness {
  id: string;
}

const db = {
  members: [] as FakeMember[],
  discoveries: [] as FakeDiscovery[],
  lists: [] as FakeList[],
  leads: [] as FakeLead[],
  businesses: [] as FakeBusiness[],
  seq: 0,
  id(p: string) {
    this.seq += 1;
    return `${p}_${this.seq}`;
  },
  reset() {
    this.members = [{ id: "mem-1", userId: "user-1", agencyId: "agency-1" }];
    this.discoveries = [
      {
        id: "disc-1",
        agencyId: "agency-1",
        cellKeys: ["medical_spa|miami|US", "med_spa|tampa|US"],
      },
    ];
    this.lists = [];
    this.leads = [];
    this.businesses = [{ id: "raw-biz-1" }, { id: "raw-biz-2" }];
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
        return row ? pick(row, select) : null;
      },
    ),
  };

  const discovery = {
    findUnique: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = db.discoveries.find((d) => d.id === where.id);
        return row ? pick(row, select) : null;
      },
    ),
  };

  const list = {
    create: vi.fn(
      async ({
        data,
        select,
      }: {
        data: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        const id = db.id("list");
        const row: FakeList = {
          id,
          agencyId: data.agencyId as string,
          ownerMemberId: data.ownerMemberId as string,
          name: data.name as string,
          serviceType: data.serviceType as string,
          filterJson: data.filterJson,
          discoveryId: (data.discoveryId as string) ?? null,
          isRaw: (data.isRaw as boolean) ?? false,
          category: (data.category as string) ?? null,
          metro: (data.metro as string) ?? null,
        };
        db.lists.push(row);
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
        const row = db.lists.find((l) => l.id === where.id);
        return row ? pick(row, select) : null;
      },
    ),
    findFirst: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { agencyId: string; discoveryId: string; isRaw: boolean };
        select?: Record<string, boolean>;
      }) => {
        const row = db.lists.find(
          (l) =>
            l.agencyId === where.agencyId &&
            l.discoveryId === where.discoveryId &&
            l.isRaw === where.isRaw,
        );
        return row ? pick(row, select) : null;
      },
    ),
  };

  const business = {
    findUnique: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = db.businesses.find((b) => b.id === where.id);
        return row ? pick(row, select) : null;
      },
    ),
  };

  const lead = {
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
            status: (d.status as string) ?? "NEW",
            statusChangedAt: new Date(),
            contactedAt: null,
            repliedAt: null,
            wonAt: null,
            lostAt: null,
          });
          count += 1;
        }
        return { count };
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
        const row = db.leads.find((l) => l.id === where.id);
        return row ? pick(row, select) : null;
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
        const row = db.leads.find((l) => l.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
    ),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { listId_businessId: { listId: string; businessId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const { listId, businessId } = where.listId_businessId;
        const existing = db.leads.find(
          (l) => l.listId === listId && l.businessId === businessId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: FakeLead = {
          id: db.id("lead"),
          listId: create.listId as string,
          agencyId: create.agencyId as string,
          businessId: create.businessId as string,
          status: create.status as string,
          statusChangedAt: create.statusChangedAt as Date,
          contactedAt: (create.contactedAt as Date) ?? null,
          repliedAt: (create.repliedAt as Date) ?? null,
          wonAt: (create.wonAt as Date) ?? null,
          lostAt: (create.lostAt as Date) ?? null,
        };
        db.leads.push(row);
        return row;
      },
    ),
  };

  return {
    default: { agencyMember, discovery, list, lead, business },
    Prisma: {},
  };
});

// ─── Import under test AFTER the mocks ──────────────────────────────────────

import { saveAsListAction, setLeadStatusAction } from "../save-list-actions";

beforeEach(() => {
  db.reset();
  SESSION = { user: { id: "user-1" } };
});
afterEach(() => vi.clearAllMocks());

// ─── saveAsListAction ────────────────────────────────────────────────────────

describe("saveAsListAction", () => {
  test("creates a CUSTOM list scoped to the agency + member with NEW leads", async () => {
    const r = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: ["b1", "b2", "b3"],
      name: "Miami spas",
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    const list = db.lists.find((l) => l.id === r.listId);
    expect(list).toBeDefined();
    expect(list?.agencyId).toBe("agency-1");
    expect(list?.ownerMemberId).toBe("mem-1");
    expect(list?.serviceType).toBe("CUSTOM");
    expect(list?.filterJson).toEqual({});
    expect(list?.discoveryId).toBe("disc-1");
    expect(list?.isRaw).toBe(false);
    // category/metro seeded from the first cellKey "medical_spa|miami|US".
    expect(list?.category).toBe("medical_spa");
    expect(list?.metro).toBe("miami");

    const leads = db.leads.filter((l) => l.listId === r.listId);
    expect(leads).toHaveLength(3);
    expect(leads.every((l) => l.status === "NEW")).toBe(true);
    expect(leads.every((l) => l.agencyId === "agency-1")).toBe(true);
  });

  test("dedupes repeated businessIds in the selection", async () => {
    const r = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: ["b1", "b1", "b2"],
      name: "Dupes",
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(db.leads.filter((l) => l.listId === r.listId)).toHaveLength(2);
  });

  test("trims the list name", async () => {
    const r = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: ["b1"],
      name: "  Padded  ",
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(db.lists.find((l) => l.id === r.listId)?.name).toBe("Padded");
  });

  test("rejects an unauthenticated caller", async () => {
    SESSION = null;
    const r = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: ["b1"],
      name: "x",
    });
    expect(r.status).toBe("unauthorized");
  });

  test("rejects a caller without an agency membership", async () => {
    db.members = [];
    const r = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: ["b1"],
      name: "x",
    });
    expect(r.status).toBe("forbidden");
  });

  test("rejects a discovery owned by another agency", async () => {
    db.discoveries = [
      { id: "disc-1", agencyId: "other-agency", cellKeys: ["a|b|US"] },
    ];
    const r = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: ["b1"],
      name: "x",
    });
    expect(r.status).toBe("forbidden");
  });

  test("rejects an empty selection (Zod)", async () => {
    const r = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: [],
      name: "x",
    });
    expect(r.status).toBe("invalid_input");
  });

  test("rejects a selection over the 500 cap (Zod)", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `b${i}`);
    const r = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: ids,
      name: "x",
    });
    expect(r.status).toBe("invalid_input");
  });

  test("rejects a blank name (Zod)", async () => {
    const r = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: ["b1"],
      name: "   ",
    });
    expect(r.status).toBe("invalid_input");
  });
});

// ─── setLeadStatusAction ─────────────────────────────────────────────────────

describe("setLeadStatusAction", () => {
  async function seedLead(agencyId = "agency-1"): Promise<string> {
    const save = await saveAsListAction({
      discoveryId: "disc-1",
      businessIds: ["b1"],
      name: "list",
    });
    if (save.status !== "ok") throw new Error("seed failed");
    const lead = db.leads.find((l) => l.listId === save.listId)!;
    lead.agencyId = agencyId;
    return lead.id;
  }

  test("flips status to CONTACTED and stamps contactedAt", async () => {
    const leadId = await seedLead();
    const r = await setLeadStatusAction({ leadId, status: "CONTACTED" });
    expect(r.status).toBe("ok");
    const lead = db.leads.find((l) => l.id === leadId)!;
    expect(lead.status).toBe("CONTACTED");
    expect(lead.contactedAt).toBeInstanceOf(Date);
    expect(lead.repliedAt).toBeNull();
  });

  test("stamps wonAt when status is WON", async () => {
    const leadId = await seedLead();
    const r = await setLeadStatusAction({ leadId, status: "WON" });
    expect(r.status).toBe("ok");
    expect(db.leads.find((l) => l.id === leadId)!.wonAt).toBeInstanceOf(Date);
  });

  test("rejects an unauthenticated caller", async () => {
    const leadId = await seedLead();
    SESSION = null;
    const r = await setLeadStatusAction({ leadId, status: "CONTACTED" });
    expect(r.status).toBe("unauthorized");
  });

  test("rejects a lead from another agency", async () => {
    const leadId = await seedLead("other-agency");
    const r = await setLeadStatusAction({ leadId, status: "CONTACTED" });
    expect(r.status).toBe("forbidden");
  });

  test("rejects an invalid status (Zod)", async () => {
    const leadId = await seedLead();
    const r = await setLeadStatusAction({ leadId, status: "BOGUS" });
    expect(r.status).toBe("invalid_input");
  });

  // The demand-flow workbench shows every discovered business, most of which
  // have no Lead row yet (Lead.listId is required — a Lead can't float free of
  // a List). Without discoveryId, "leadId" for an unsaved row IS the raw
  // Business id, which never resolves to a Lead → "Couldn't update the lead"
  // (the exact prod bug this locks in place).
  describe("businessId fallback (discoveryId provided)", () => {
    test("without discoveryId, an unsaved row's businessId-as-leadId is forbidden (the prod bug)", async () => {
      const r = await setLeadStatusAction({
        leadId: "raw-biz-1",
        status: "CONTACTED",
      });
      expect(r.status).toBe("forbidden");
    });

    test("with discoveryId, upserts a Lead into the discovery's raw list instead of failing", async () => {
      const r = await setLeadStatusAction({
        leadId: "raw-biz-1",
        status: "CONTACTED",
        discoveryId: "disc-1",
      });
      expect(r.status).toBe("ok");

      const list = db.lists.find((l) => l.discoveryId === "disc-1" && l.isRaw);
      expect(list).toBeDefined();

      const lead = db.leads.find(
        (l) => l.listId === list!.id && l.businessId === "raw-biz-1",
      );
      expect(lead).toBeDefined();
      expect(lead!.status).toBe("CONTACTED");
      expect(lead!.agencyId).toBe("agency-1");
      expect(lead!.contactedAt).toBeInstanceOf(Date);
    });

    test("reuses the SAME raw list across multiple businesses (doesn't fork one per call)", async () => {
      await setLeadStatusAction({
        leadId: "raw-biz-1",
        status: "CONTACTED",
        discoveryId: "disc-1",
      });
      await setLeadStatusAction({
        leadId: "raw-biz-2",
        status: "CONTACTED",
        discoveryId: "disc-1",
      });
      const rawLists = db.lists.filter(
        (l) => l.discoveryId === "disc-1" && l.isRaw,
      );
      expect(rawLists).toHaveLength(1);
    });

    test("a second status change on the same business UPDATES the same Lead, not a duplicate", async () => {
      await setLeadStatusAction({
        leadId: "raw-biz-1",
        status: "CONTACTED",
        discoveryId: "disc-1",
      });
      await setLeadStatusAction({
        leadId: "raw-biz-1",
        status: "WON",
        discoveryId: "disc-1",
      });
      const matches = db.leads.filter((l) => l.businessId === "raw-biz-1");
      expect(matches).toHaveLength(1);
      expect(matches[0]!.status).toBe("WON");
      expect(matches[0]!.contactedAt).toBeInstanceOf(Date); // stamped earlier, not cleared
      expect(matches[0]!.wonAt).toBeInstanceOf(Date);
    });

    test("rejects when the discovery belongs to another agency", async () => {
      db.discoveries.push({
        id: "disc-other",
        agencyId: "other-agency",
        cellKeys: [],
      });
      const r = await setLeadStatusAction({
        leadId: "raw-biz-1",
        status: "CONTACTED",
        discoveryId: "disc-other",
      });
      expect(r.status).toBe("forbidden");
    });

    test("rejects when leadId matches neither a Lead nor a real Business", async () => {
      const r = await setLeadStatusAction({
        leadId: "not-a-real-id",
        status: "CONTACTED",
        discoveryId: "disc-1",
      });
      expect(r.status).toBe("forbidden");
    });
  });
});
