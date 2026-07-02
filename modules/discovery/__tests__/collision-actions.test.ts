// WP6-15 · unit tests for otherAgenciesOnCellsAction (lead-collision count).
//
// Mocks @/lib/auth (session) + @/lib/prisma (agencyMember + discovery). The
// invariants under test:
//   - counts DISTINCT other agencies whose Discovery.cellKeys overlap the cells
//     (excludes the caller's own agency).
//   - auth + membership gate the action; Zod rejects empty/oversized input.
//   - dedupes agencies (one agency with two overlapping discoveries = 1).

import { beforeEach, describe, expect, test, vi } from "vitest";

let SESSION: { user?: { id?: string } } | null = { user: { id: "user-1" } };

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => SESSION),
}));

interface FakeDiscovery {
  agencyId: string;
  cellKeys: string[];
}

const db = {
  member: null as { agencyId: string } | null,
  discoveries: [] as FakeDiscovery[],
};

vi.mock("@/lib/prisma", () => ({
  default: {
    agencyMember: {
      findFirst: vi.fn(async () => db.member),
    },
    discovery: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            agencyId?: { not?: string };
            cellKeys?: { hasSome?: string[] };
          };
        }) => {
          const excludeAgency = where.agencyId?.not;
          const needles = where.cellKeys?.hasSome ?? [];
          return db.discoveries
            .filter((d) => d.agencyId !== excludeAgency)
            .filter((d) => d.cellKeys.some((k) => needles.includes(k)))
            .map((d) => ({ agencyId: d.agencyId }));
        },
      ),
    },
  },
  Prisma: {},
}));

import { otherAgenciesOnCellsAction } from "../collision-actions";

const CELLS = [
  { categorySlug: "med-spa", metroSlug: "miami-fl", country: "US" },
];

beforeEach(() => {
  SESSION = { user: { id: "user-1" } };
  db.member = { agencyId: "agency-mine" };
  db.discoveries = [];
});

describe("otherAgenciesOnCellsAction", () => {
  test("counts distinct OTHER agencies overlapping the cells", async () => {
    db.discoveries = [
      { agencyId: "agency-A", cellKeys: ["med-spa|miami-fl|US"] },
      { agencyId: "agency-B", cellKeys: ["med-spa|miami-fl|US", "x|y|US"] },
      { agencyId: "agency-mine", cellKeys: ["med-spa|miami-fl|US"] }, // self
      { agencyId: "agency-C", cellKeys: ["other|cell|US"] }, // no overlap
    ];
    const res = await otherAgenciesOnCellsAction(CELLS);
    expect(res).toEqual({ status: "ok", otherAgencies: 2 }); // A + B
  });

  test("dedupes an agency with multiple overlapping discoveries", async () => {
    db.discoveries = [
      { agencyId: "agency-A", cellKeys: ["med-spa|miami-fl|US"] },
      { agencyId: "agency-A", cellKeys: ["med-spa|miami-fl|US"] }, // same agency
    ];
    const res = await otherAgenciesOnCellsAction(CELLS);
    expect(res).toEqual({ status: "ok", otherAgencies: 1 });
  });

  test("returns 0 when no other agency overlaps", async () => {
    db.discoveries = [
      { agencyId: "agency-mine", cellKeys: ["med-spa|miami-fl|US"] },
    ];
    const res = await otherAgenciesOnCellsAction(CELLS);
    expect(res).toEqual({ status: "ok", otherAgencies: 0 });
  });

  test("unauthorized without a session", async () => {
    SESSION = null;
    const res = await otherAgenciesOnCellsAction(CELLS);
    expect(res.status).toBe("unauthorized");
  });

  test("forbidden when the user is not an agency member", async () => {
    db.member = null;
    const res = await otherAgenciesOnCellsAction(CELLS);
    expect(res.status).toBe("forbidden");
  });

  test("invalid_input for an empty cell list", async () => {
    const res = await otherAgenciesOnCellsAction([]);
    expect(res.status).toBe("invalid_input");
  });

  test("invalid_input for a malformed cell", async () => {
    const res = await otherAgenciesOnCellsAction([{ categorySlug: "" }]);
    expect(res.status).toBe("invalid_input");
  });
});
