import { describe, expect, test } from "vitest";

import { __test, suggestServicesFromGoogleCategories } from "../from-google";

describe("suggestServicesFromGoogleCategories", () => {
  test("returns starter list for a known primary category", () => {
    const out = suggestServicesFromGoogleCategories("medical_spa", []);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.sourceHint === "medical_spa")).toBe(true);
    expect(out[0]?.category).toBe("Injectables");
  });

  test("merges suggestions across primary + secondary categories", () => {
    const out = suggestServicesFromGoogleCategories("medical_spa", ["day_spa"]);
    // medical_spa contributes Botox/Lip filler/Dermal fillers; day_spa
    // contributes Massage/Facial/Body treatment — no overlap, so we
    // expect the union.
    const names = out.map((s) => s.name);
    expect(names).toContain("Botox");
    expect(names).toContain("Massage");
  });

  test("dedups by case-insensitive name across categories", () => {
    // hair_salon and beauty_salon don't overlap by default, but if we
    // pass the same category twice we should still emit each service once.
    const out = suggestServicesFromGoogleCategories("hair_salon", [
      "hair_salon",
    ]);
    const counts = new Map<string, number>();
    for (const s of out) {
      const k = s.name.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      expect(count).toBe(1);
    }
  });

  test("returns empty list for unknown categories", () => {
    const out = suggestServicesFromGoogleCategories(
      "fictional_widget_factory",
      ["other_unknown_code"],
    );
    expect(out).toEqual([]);
  });

  test("handles null / undefined primary category gracefully", () => {
    expect(suggestServicesFromGoogleCategories(null, [])).toEqual([]);
    expect(suggestServicesFromGoogleCategories(undefined, [])).toEqual([]);
  });

  test("preserves order — primary category services come first", () => {
    const out = suggestServicesFromGoogleCategories("medical_spa", ["day_spa"]);
    const medSpaIdx = out.findIndex((s) => s.name === "Botox");
    const spaIdx = out.findIndex((s) => s.name === "Massage");
    expect(medSpaIdx).toBeGreaterThanOrEqual(0);
    expect(spaIdx).toBeGreaterThan(medSpaIdx);
  });

  test("every category mapping caps at 5 services (friction-low rule)", () => {
    for (const [code, starter] of Object.entries(__test.STARTERS_BY_CATEGORY)) {
      expect(
        starter.services.length,
        `category ${code} should have ≤ 5 starter services`,
      ).toBeLessThanOrEqual(5);
      expect(
        starter.services.length,
        `category ${code} should have ≥ 1 starter service`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
