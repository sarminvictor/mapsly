import { describe, expect, test } from "vitest";

import { isHumanMedicalCategory } from "../medical-category";

describe("isHumanMedicalCategory", () => {
  test.each([
    "med spa",
    "medical spa",
    "Medspa",
    "dental clinic",
    "dentist",
    "orthodontist",
    "dermatologist",
    "plastic surgeon",
    "chiropractor",
    "physical therapy clinic",
    "physiotherapist",
    "urgent care center",
    "pediatric clinic",
    "psychiatrist",
    "psychologist",
    "mental health clinic",
    "marriage counselor",
    "fertility clinic",
    "weight loss clinic",
    "optometrist",
    "podiatrist",
    "wellness clinic",
    "hospital",
    "family doctor",
    "health center",
  ])("medical · %s → true", (category) => {
    expect(isHumanMedicalCategory(category)).toBe(true);
  });

  test.each([
    "restaurant",
    "hair salon",
    "barber shop",
    "auto body shop",
    "gym",
    "bakery",
    "plumber",
    "law firm",
    "real estate agency",
  ])("non-medical · %s → false", (category) => {
    expect(isHumanMedicalCategory(category)).toBe(false);
  });

  // Normalization: separator + case variants must not bypass the
  // matcher. Category strings arrive from DataForSEO, Google, and
  // manual entry — "Med-Spa" and "med spa" are the same business.
  test.each([
    "Med-Spa",
    "med-spa",
    "MEDICAL SPA",
    "IV-therapy",
    "weight_loss clinic",
    "Weight-Loss Center",
  ])("normalization · %s → true", (category) => {
    expect(isHumanMedicalCategory(category)).toBe(true);
  });

  // Scope additions from the red-team pass: these were FALSE before —
  // only "wellness clinic", "weight loss clinic", and "laser (clinic|
  // hair)" matched. All of these run IV drips, hormone panels, or
  // medical lasers under softer names.
  test.each([
    "wellness center",
    "wellness studio",
    "wellness",
    "medical aesthetics",
    "laser clinic",
    "laser center",
    "laser hair removal",
    "iv therapy",
    "IV hydration",
    "weight loss center",
    "weight loss program",
  ])("scope · %s → true", (category) => {
    expect(isHumanMedicalCategory(category)).toBe(true);
  });

  // VETERINARY DECISION: vets are NOT HIPAA-covered (animal patients).
  // They keep the natural reply style — the vet check runs before the
  // medical pattern so "veterinary clinic" doesn't match via "clinic".
  test.each([
    "veterinary clinic",
    "veterinarian",
    "vet",
    "animal hospital",
    "pet grooming",
    // Broad "wellness" must not pull vets back in.
    "pet wellness center",
    "pet spa",
  ])("veterinary exclusion · %s → false", (category) => {
    expect(isHumanMedicalCategory(category)).toBe(false);
  });

  // "Esthetician" (day-spa facials) stays false ON PURPOSE: the medical
  // spelling "aesthetic(s)" matches, the day-spa spelling doesn't. The
  // badge keys off this matcher too — "HIPAA-aware" on a facialist's
  // panel would read wrong.
  test("esthetician → false (day-spa spelling, non-medical)", () => {
    expect(isHumanMedicalCategory("esthetician")).toBe(false);
  });

  // Over-inclusive by design — a massage therapist gets discretion too.
  // False positives only make replies more generic; false negatives
  // risk a fine.
  test("massage therapist → true (over-inclusion is deliberate)", () => {
    expect(isHumanMedicalCategory("massage therapist")).toBe(true);
  });

  test("empty / null / undefined → false", () => {
    expect(isHumanMedicalCategory("")).toBe(false);
    expect(isHumanMedicalCategory("   ")).toBe(false);
    expect(isHumanMedicalCategory(null)).toBe(false);
    expect(isHumanMedicalCategory(undefined)).toBe(false);
  });
});
