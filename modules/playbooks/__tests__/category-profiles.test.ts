// Phase 7 · CATEGORY_PROFILES is the code-versioned source of truth for the 5
// launch verticals; seedCategoryProfiles upserts each idempotently on the
// @@unique([categorySlug, version]) compound key (prisma mocked).

import { beforeEach, describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  categoryProfile: { upsert: vi.fn().mockResolvedValue({}) },
}));
vi.mock("@/lib/prisma", () => ({
  default: prismaMock,
  Prisma: { JsonNull: "JsonNull" },
}));

import { CATEGORY_PROFILES, seedCategoryProfiles } from "../category-profiles";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CATEGORY_PROFILES", () => {
  test("covers the 5 launch verticals", () => {
    expect(Object.keys(CATEGORY_PROFILES).sort()).toEqual(
      ["auto-body", "dental", "hvac", "med-spa", "restaurant"].sort(),
    );
  });

  test("each profile is fully populated + self-consistent slug", () => {
    for (const [key, p] of Object.entries(CATEGORY_PROFILES)) {
      expect(p.categorySlug, key).toBe(key);
      expect(p.version, key).toBe(1);
      expect(p.displayName.length, key).toBeGreaterThan(0);
      expect(p.vocabulary.customerNoun, key).toBeTruthy();
      expect(p.regulations.length, key).toBeGreaterThan(0);
      expect(p.benchmarks.rating, key).toBeGreaterThan(0);
      expect(p.pitchNuances.headline, key).toBeTruthy();
      expect(p.pitchNuances.resonates.length, key).toBeGreaterThan(0);
    }
  });
});

describe("seedCategoryProfiles", () => {
  test("upserts one row per profile, keyed by [categorySlug, version]", async () => {
    const outcome = await seedCategoryProfiles();

    expect(outcome.upserted).toBe(Object.keys(CATEGORY_PROFILES).length);
    expect(prismaMock.categoryProfile.upsert).toHaveBeenCalledTimes(
      Object.keys(CATEGORY_PROFILES).length,
    );

    // Spot-check the med-spa upsert shape.
    const calls = prismaMock.categoryProfile.upsert.mock.calls.map((c) => c[0]);
    const medSpa = calls.find(
      (c) =>
        c.where.categorySlug_version.categorySlug === "med-spa" &&
        c.where.categorySlug_version.version === 1,
    );
    expect(medSpa).toBeDefined();
    expect(medSpa.create).toMatchObject({
      categorySlug: "med-spa",
      version: 1,
      displayName: "Med spa",
    });
    // JSON columns are serialized onto both create + update (idempotent refresh).
    expect(medSpa.create.vocabulary).toBeDefined();
    expect(medSpa.update.benchmarks).toBeDefined();
    expect(medSpa.update.regulations).toBeDefined();
  });

  test("is idempotent — re-run upserts the same keys again, no inserts of new rows", async () => {
    await seedCategoryProfiles();
    await seedCategoryProfiles();
    expect(prismaMock.categoryProfile.upsert).toHaveBeenCalledTimes(
      Object.keys(CATEGORY_PROFILES).length * 2,
    );
    // Every call uses the compound unique → upsert (never a bare create).
    for (const call of prismaMock.categoryProfile.upsert.mock.calls) {
      expect(call[0].where.categorySlug_version).toBeDefined();
    }
  });
});
