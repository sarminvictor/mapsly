// Integration tests for daily/list-refresh-daily handler.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeList {
  id: string;
  agencyId: string;
  isActive: boolean;
  refreshCadence: "DAILY" | "WEEKLY" | "MANUAL";
  category: string | null;
  metro: string | null;
  radiusMi: number | null;
  filterJson: unknown;
  lastRefreshedAt: Date | null;
}
interface FakeBiz {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  rating: number | null;
  reviewCount: number | null;
  photosCount: number | null;
  website: string | null;
  phone: string | null;
  isClaimed: boolean;
  lastRefreshedAt: Date | null;
  isActive: boolean;
  snapshots: unknown[];
  lighthouseAudits: unknown[];
}
interface FakeLead {
  id: string;
  listId: string;
  agencyId: string;
  businessId: string;
  status: string;
}

const db = {
  lists: new Map<string, FakeList>(),
  businesses: new Map<string, FakeBiz>(),
  leads: new Map<string, FakeLead>(),
  listRefreshes: [] as Array<{
    listId: string;
    matchesBefore: number;
    matchesAfter: number;
    added: number;
    removed: number;
  }>,
  cronRuns: new Map<
    string,
    {
      id: string;
      job: string;
      status: string;
      meta: Record<string, unknown> | null;
      itemsProcessed: number;
      costUsd: number;
      finishedAt: Date | null;
    }
  >(),
  nextId: 1,
  reset() {
    this.lists.clear();
    this.businesses.clear();
    this.leads.clear();
    this.listRefreshes = [];
    this.cronRuns.clear();
    this.nextId = 1;
  },
};

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  Prisma: { sql: vi.fn() },
  default: {
    list: {
      findMany: vi.fn(
        async ({
          take,
        }: {
          take: number;
          where: { isActive: boolean; refreshCadence: string };
        }) => {
          return Array.from(db.lists.values())
            .filter((l) => l.isActive && l.refreshCadence === "DAILY")
            .slice(0, take);
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakeList>;
        }) => {
          const row = db.lists.get(where.id);
          if (!row) throw new Error("not found");
          Object.assign(row, data);
          return row;
        },
      ),
    },
    business: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { category?: string; city?: string; isActive: boolean };
        }) => {
          return Array.from(db.businesses.values()).filter((b) => {
            if (!b.isActive) return false;
            if (where.category && b.category !== where.category) return false;
            if (where.city && b.city !== where.city) return false;
            return true;
          });
        },
      ),
    },
    lead: {
      findMany: vi.fn(async ({ where }: { where: { listId: string } }) => {
        return Array.from(db.leads.values()).filter(
          (l) => l.listId === where.listId,
        );
      }),
      createMany: vi.fn(
        async ({
          data,
        }: {
          data: Array<{
            listId: string;
            agencyId: string;
            businessId: string;
            status: string;
          }>;
        }) => {
          let created = 0;
          for (const item of data) {
            const key = `${item.listId}::${item.businessId}`;
            if (
              Array.from(db.leads.values()).some(
                (l) => `${l.listId}::${l.businessId}` === key,
              )
            )
              continue;
            const id = `lead_${db.nextId++}`;
            db.leads.set(id, { id, ...item });
            created += 1;
          }
          return { count: created };
        },
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => {
          let count = 0;
          for (const id of where.id.in) {
            if (db.leads.delete(id)) count += 1;
          }
          return { count };
        },
      ),
    },
    listRefresh: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            listId: string;
            matchesBefore: number;
            matchesAfter: number;
            added: number;
            removed: number;
          };
        }) => {
          db.listRefreshes.push(data);
          return { id: `lr_${db.nextId++}`, ...data };
        },
      ),
    },
    cronRun: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { job: string; status: string; costUsd?: number };
        }) => {
          const id = `run_${db.nextId++}`;
          db.cronRuns.set(id, {
            id,
            job: data.job,
            status: data.status,
            costUsd: data.costUsd ?? 0,
            finishedAt: null,
            itemsProcessed: 0,
            meta: null,
          });
          return { id, job: data.job, startedAt: new Date() };
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
          const row = db.cronRuns.get(where.id);
          if (!row) throw new Error("not found");
          if (typeof data.status === "string") row.status = data.status;
          if (data.finishedAt instanceof Date) row.finishedAt = data.finishedAt;
          if (typeof data.itemsProcessed === "number")
            row.itemsProcessed = data.itemsProcessed;
          if (data.meta && typeof data.meta === "object")
            row.meta = data.meta as Record<string, unknown>;
          if (
            data.costUsd &&
            typeof data.costUsd === "object" &&
            "increment" in (data.costUsd as Record<string, unknown>)
          ) {
            row.costUsd += (data.costUsd as { increment: number }).increment;
          }
          return row;
        },
      ),
    },
  },
}));

// Make the hunter evaluator deterministic + test-controllable.
const evaluateSpecMock = vi.fn((row: { id: string }, _spec: unknown) =>
  row.id.startsWith("match_"),
);
vi.mock("@/modules/hunter", () => ({
  evaluateSpec: (row: { id: string }, spec: unknown) =>
    evaluateSpecMock(row, spec),
}));

import { GET, parseFilterSpec } from "../list-refresh-daily/route";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  db.reset();
  evaluateSpecMock.mockClear();
  process.env.CRON_SECRET = "test-secret-abc";
});

afterEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function authedRequest() {
  return new Request("https://x/y", {
    headers: { authorization: "Bearer test-secret-abc" },
  });
}

describe("parseFilterSpec", () => {
  test("null → null", () => expect(parseFilterSpec(null)).toBeNull());
  test("non-object → null", () => {
    expect(parseFilterSpec("oops")).toBeNull();
    expect(parseFilterSpec(42)).toBeNull();
    expect(parseFilterSpec([])).toBeNull();
  });
  test("missing arrays → null", () => expect(parseFilterSpec({})).toBeNull());
  test("rows array → spec", () => {
    const spec = parseFilterSpec({
      rows: [{ column: "x", op: "=", value: 1 }],
    });
    expect(spec).not.toBeNull();
    expect(spec?.rows).toHaveLength(1);
  });
  test("combine= and|or coerced", () => {
    expect(parseFilterSpec({ rows: [], combine: "or" })?.combine).toBe("or");
    expect(
      parseFilterSpec({ rows: [], combine: "bogus" })?.combine,
    ).toBeUndefined();
  });
});

describe("daily/list-refresh-daily · cron handler", () => {
  test("rejects unauthorized", async () => {
    const res = await GET(new Request("https://x/y"));
    expect(res.status).toBe(401);
  });

  test("no lists → OK 0", async () => {
    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { itemsProcessed: number };
    expect(body.itemsProcessed).toBe(0);
  });

  test("inserts new matching leads + records ListRefresh", async () => {
    db.lists.set("L1", {
      id: "L1",
      agencyId: "A1",
      isActive: true,
      refreshCadence: "DAILY",
      category: null,
      metro: null,
      radiusMi: null,
      filterJson: { rows: [{ column: "x", op: "=", value: 1 }] },
      lastRefreshedAt: null,
    });
    db.businesses.set("match_a", makeBiz("match_a", "match-a"));
    db.businesses.set("match_b", makeBiz("match_b", "match-b"));
    db.businesses.set("nope_c", makeBiz("nope_c", "nope-c"));

    await GET(authedRequest());

    const leads = Array.from(db.leads.values());
    expect(leads).toHaveLength(2);
    expect(new Set(leads.map((l) => l.businessId))).toEqual(
      new Set(["match_a", "match_b"]),
    );
    expect(leads.every((l) => l.status === "NEW")).toBe(true);

    expect(db.listRefreshes).toHaveLength(1);
    expect(db.listRefreshes[0].added).toBe(2);
    expect(db.listRefreshes[0].removed).toBe(0);
  });

  test("removes de-qualified NEW leads + preserves CONTACTED ones", async () => {
    db.lists.set("L1", {
      id: "L1",
      agencyId: "A1",
      isActive: true,
      refreshCadence: "DAILY",
      category: null,
      metro: null,
      radiusMi: null,
      filterJson: { rows: [{ column: "x", op: "=", value: 1 }] },
      lastRefreshedAt: null,
    });
    db.businesses.set("match_a", makeBiz("match_a", "a"));
    db.businesses.set("nope_b", makeBiz("nope_b", "b"));
    db.businesses.set("nope_c", makeBiz("nope_c", "c"));

    db.leads.set("lead_old_new", {
      id: "lead_old_new",
      listId: "L1",
      agencyId: "A1",
      businessId: "nope_b",
      status: "NEW",
    });
    db.leads.set("lead_old_contacted", {
      id: "lead_old_contacted",
      listId: "L1",
      agencyId: "A1",
      businessId: "nope_c",
      status: "CONTACTED",
    });

    await GET(authedRequest());

    // NEW removed, CONTACTED preserved, match_a inserted as NEW.
    const remaining = Array.from(db.leads.values()).map((l) => ({
      bid: l.businessId,
      status: l.status,
    }));
    expect(remaining).toContainEqual({ bid: "nope_c", status: "CONTACTED" });
    expect(remaining).toContainEqual({ bid: "match_a", status: "NEW" });
    expect(remaining.some((l) => l.bid === "nope_b")).toBe(false);

    expect(db.listRefreshes[0].added).toBe(1);
    expect(db.listRefreshes[0].removed).toBe(1);
  });

  test("malformed filter spec → zero-delta refresh, no crash", async () => {
    db.lists.set("L1", {
      id: "L1",
      agencyId: "A1",
      isActive: true,
      refreshCadence: "DAILY",
      category: null,
      metro: null,
      radiusMi: null,
      filterJson: "totally not a spec",
      lastRefreshedAt: null,
    });
    db.businesses.set("match_a", makeBiz("match_a", "x"));

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    // refresh recorded but no leads inserted (spec was null)
    expect(db.listRefreshes).toHaveLength(1);
    expect(db.listRefreshes[0].added).toBe(0);
    expect(db.leads.size).toBe(0);
  });
});

function makeBiz(id: string, slug: string): FakeBiz {
  return {
    id,
    slug,
    name: id,
    category: "Beauty salon",
    city: null,
    province: null,
    country: "US",
    rating: 4.5,
    reviewCount: 20,
    photosCount: 5,
    website: null,
    phone: null,
    isClaimed: false,
    lastRefreshedAt: null,
    isActive: true,
    snapshots: [],
    lighthouseAudits: [],
  };
}
