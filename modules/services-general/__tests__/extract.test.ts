// Tests for services-general extraction:
//   1. ServiceTaxonomy self-builds: a new surface form is recorded as a
//      "candidate" and PROMOTED to "canonical" on its 3rd business (≥3).
//   2. AI-extracted services persist as BusinessService rows with canonicalKey
//      / confidence / detectedVia / rawNames.
//   3. recomputeCellServicePrevalence computes prevalence = offering/sampleSize
//      and ranks descending.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- AI client mock -----------------------------------------------------
const ai = vi.hoisted(() => ({ callOpenAi: vi.fn() }));
vi.mock("@/services/ai/client", () => ({ callOpenAi: ai.callOpenAi }));

// ---- deterministic detectors: stub to empty so the AI layer is isolated ---
vi.mock("@/services/business-services-detect", () => ({
  detectFromPlaceTopics: vi.fn(() => []),
  detectFromDescription: vi.fn(() => []),
  pickTaxonomyForCategories: vi.fn(() => []),
}));

// ---- prisma mock --------------------------------------------------------
interface TaxRow {
  id: string;
  categorySlug: string;
  canonicalKey: string;
  occurrences: number;
  status: string;
  synonyms: string[];
}

const db = vi.hoisted(() => {
  const taxonomy = new Map<string, TaxRow>(); // key = categorySlug|canonicalKey
  const bsCreates: Array<Record<string, unknown>> = [];
  const bsUpdates: Array<Record<string, unknown>> = [];
  const prevalenceUpserts: Array<Record<string, unknown>> = [];
  let existingServices: Array<Record<string, unknown>> = [];
  let cellBusinesses: Array<Record<string, unknown>> = [];
  let business: Record<string, unknown> | null = null;
  let nextTaxId = 1;
  return {
    taxonomy,
    bsCreates,
    bsUpdates,
    prevalenceUpserts,
    nextTaxId: () => nextTaxId++,
    setExistingServices(s: Array<Record<string, unknown>>) {
      existingServices = s;
    },
    getExistingServices() {
      return existingServices;
    },
    setCellBusinesses(b: Array<Record<string, unknown>>) {
      cellBusinesses = b;
    },
    getCellBusinesses() {
      return cellBusinesses;
    },
    setBusiness(b: Record<string, unknown> | null) {
      business = b;
    },
    getBusiness() {
      return business;
    },
  };
});

function taxKey(categorySlug: string, canonicalKey: string): string {
  return `${categorySlug}|${canonicalKey}`;
}

vi.mock("@/lib/prisma", () => ({
  default: {
    business: {
      findUnique: vi.fn(async () => db.getBusiness()),
      findMany: vi.fn(async () => db.getCellBusinesses()),
    },
    serviceTaxonomy: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            categorySlug_canonicalKey: {
              categorySlug: string;
              canonicalKey: string;
            };
          };
        }) => {
          const { categorySlug, canonicalKey } =
            where.categorySlug_canonicalKey;
          return db.taxonomy.get(taxKey(categorySlug, canonicalKey)) ?? null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: TaxRow = {
          id: `tax_${db.nextTaxId()}`,
          categorySlug: data.categorySlug as string,
          canonicalKey: data.canonicalKey as string,
          occurrences: data.occurrences as number,
          status: data.status as string,
          synonyms: (data.synonyms as string[]) ?? [],
        };
        db.taxonomy.set(taxKey(row.categorySlug, row.canonicalKey), row);
        return row;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          for (const row of db.taxonomy.values()) {
            if (row.id === where.id) {
              if (typeof data.occurrences === "number")
                row.occurrences = data.occurrences;
              if (typeof data.status === "string") row.status = data.status;
              if (Array.isArray(data.synonyms))
                row.synonyms = data.synonyms as string[];
              return row;
            }
          }
          return null;
        },
      ),
    },
    businessService: {
      findMany: vi.fn(async () => db.getExistingServices()),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.bsCreates.push(data);
        return { id: `bs_${db.bsCreates.length}` };
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        db.bsUpdates.push(args);
        return { id: "bs_x" };
      }),
    },
    cellServicePrevalence: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        db.prevalenceUpserts.push(args);
        return { id: `csp_${db.prevalenceUpserts.length}` };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
  Prisma: { JsonNull: null },
}));

import {
  extractServicesForBusiness,
  recomputeCellServicePrevalence,
  canonicalKeyOf,
  PROMOTION_THRESHOLD,
} from "../extract";

const CELL = "auto_repair|miami|US";

function baseBusiness(id: string) {
  return {
    id,
    category: "auto_repair",
    categories: ["Auto repair shop"],
    categoryIds: ["auto_repair"],
    description: "We do oil changes and brake service.",
    placeTopics: { "oil change": 10, brakes: 4 },
  };
}

function mockAiServices(names: string[]): void {
  ai.callOpenAi.mockResolvedValue({
    text: JSON.stringify({
      services: names.map((name) => ({ name, group: null })),
    }),
    finishReason: "stop",
    usage: { inputTokens: 50, outputTokens: 20 },
    costUsd: 0.0001,
    model: "gpt-5.4-nano",
  });
}

beforeEach(() => {
  db.taxonomy.clear();
  db.bsCreates.length = 0;
  db.bsUpdates.length = 0;
  db.prevalenceUpserts.length = 0;
  db.setExistingServices([]);
  db.setCellBusinesses([]);
  db.setBusiness(null);
  ai.callOpenAi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("extractServicesForBusiness · taxonomy self-build", () => {
  test("promotes a surface form to canonical on its 3rd business (≥3)", async () => {
    expect(PROMOTION_THRESHOLD).toBe(3);
    mockAiServices(["Oil change"]);
    const key = canonicalKeyOf("Oil change");

    // Business 1 → candidate (occurrences 1).
    db.setBusiness(baseBusiness("b1"));
    const r1 = await extractServicesForBusiness("b1");
    expect(r1.promotedKeys).toEqual([]);
    expect(db.taxonomy.get(`auto_repair|${key}`)?.status).toBe("candidate");
    expect(db.taxonomy.get(`auto_repair|${key}`)?.occurrences).toBe(1);

    // Business 2 → still candidate (occurrences 2).
    db.setBusiness(baseBusiness("b2"));
    const r2 = await extractServicesForBusiness("b2");
    expect(r2.promotedKeys).toEqual([]);
    expect(db.taxonomy.get(`auto_repair|${key}`)?.status).toBe("candidate");
    expect(db.taxonomy.get(`auto_repair|${key}`)?.occurrences).toBe(2);

    // Business 3 → PROMOTED to canonical (occurrences 3 ≥ 3).
    db.setBusiness(baseBusiness("b3"));
    const r3 = await extractServicesForBusiness("b3");
    expect(r3.promotedKeys).toContain(key);
    expect(db.taxonomy.get(`auto_repair|${key}`)?.status).toBe("canonical");
    expect(db.taxonomy.get(`auto_repair|${key}`)?.occurrences).toBe(3);
  });

  test("persists a BusinessService row with canonicalKey/confidence/detectedVia/rawNames", async () => {
    mockAiServices(["Brake service"]);
    db.setBusiness(baseBusiness("b1"));
    const res = await extractServicesForBusiness("b1");

    expect(res.created).toBe(1);
    expect(db.bsCreates).toHaveLength(1);
    const created = db.bsCreates[0];
    expect(created.canonicalKey).toBe(canonicalKeyOf("Brake service"));
    expect(created.confidence).toBe(0.6);
    expect(created.detectedVia).toEqual(["ai:open"]);
    expect(created.rawNames).toEqual(["Brake service"]);
    expect(created.businessId).toBe("b1");
  });

  test("re-running merges into an existing canonicalKey row instead of duplicating", async () => {
    mockAiServices(["Oil change"]);
    const key = canonicalKeyOf("Oil change");
    db.setBusiness(baseBusiness("b1"));
    db.setExistingServices([
      {
        id: "existing_1",
        canonicalKey: key,
        confidence: 0.5,
        detectedVia: ["auto:place-topics"],
        rawNames: ["oil change"],
        sortOrder: 0,
      },
    ]);
    const res = await extractServicesForBusiness("b1");
    expect(res.created).toBe(0);
    expect(res.updated).toBe(1);
    expect(db.bsCreates).toHaveLength(0);
    expect(db.bsUpdates).toHaveLength(1);
    const upd = db.bsUpdates[0] as { data: Record<string, unknown> };
    // higher of (0.5, 0.6)
    expect(upd.data.confidence).toBe(0.6);
    expect(upd.data.detectedVia).toEqual(
      expect.arrayContaining(["auto:place-topics", "ai:open"]),
    );
  });
});

describe("recomputeCellServicePrevalence", () => {
  test("prevalence = offering/sampleSize, ranked descending", async () => {
    // 4 businesses; "oil_change" offered by 3, "detailing" by 1.
    db.setCellBusinesses([
      {
        id: "a",
        services: [{ canonicalKey: "oil_change", name: "Oil change" }],
      },
      {
        id: "b",
        services: [{ canonicalKey: "oil_change", name: "Oil change" }],
      },
      {
        id: "c",
        services: [
          { canonicalKey: "oil_change", name: "Oil change" },
          { canonicalKey: "detailing", name: "Detailing" },
        ],
      },
      { id: "d", services: [] },
    ]);

    const res = await recomputeCellServicePrevalence(CELL);
    expect(res.sampleSize).toBe(4);
    expect(res.servicesWritten).toBe(2);
    expect(db.prevalenceUpserts).toHaveLength(2);

    const byKey = new Map(
      db.prevalenceUpserts.map((u) => {
        const create = (u as { create: Record<string, unknown> }).create;
        return [create.canonicalKey as string, create];
      }),
    );
    expect(byKey.get("oil_change")!.prevalence).toBeCloseTo(0.75, 6);
    expect(byKey.get("oil_change")!.rank).toBe(1);
    expect(byKey.get("detailing")!.prevalence).toBeCloseTo(0.25, 6);
    expect(byKey.get("detailing")!.rank).toBe(2);
    // cell parts derived from cellKey.
    expect(byKey.get("oil_change")!.category).toBe("auto_repair");
    expect(byKey.get("oil_change")!.city).toBe("miami");
    expect(byKey.get("oil_change")!.country).toBe("US");
  });

  test("counts each business once per key even with duplicate service rows", async () => {
    db.setCellBusinesses([
      {
        id: "a",
        services: [
          { canonicalKey: "oil_change", name: "Oil change" },
          { canonicalKey: "oil_change", name: "oil change" },
        ],
      },
    ]);
    const res = await recomputeCellServicePrevalence(CELL);
    expect(res.sampleSize).toBe(1);
    const create = (
      db.prevalenceUpserts[0] as { create: Record<string, unknown> }
    ).create;
    expect(create.prevalence).toBe(1);
  });
});
