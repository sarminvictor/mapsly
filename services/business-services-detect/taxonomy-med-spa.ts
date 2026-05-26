/**
 * Med-spa service taxonomy · Phase-1 vertical.
 *
 * Each entry is one canonical service (the row that lands in
 * `BusinessService`). Synonyms cover the various ways a service can
 * be referred to across:
 *   - DfS `category_ids` slugs (e.g. "laser_hair_removal_service")
 *   - DfS `place_topics` keys (lowercased customer-review terms)
 *   - DfS `description` long-form text
 *   - Website service-page headings / list items
 *
 * Adding a service: append an entry with a unique canonicalKey. Keep
 * synonyms lowercased + ordered by likelihood (most common first).
 *
 * Per `.claude/rules/copy-voice.md` · SMB voice · "Lip filler" not
 * "Hyaluronic acid dermal filler injection."
 */

import type { ServiceTaxonomyEntry } from "./types";

export const MED_SPA_TAXONOMY: readonly ServiceTaxonomyEntry[] = [
  // ── Injectables ─────────────────────────────────────────────────────
  {
    canonicalKey: "botox",
    displayName: "Botox",
    group: "Injectables",
    synonyms: ["botox", "dysport", "xeomin", "botulinum toxin", "neurotoxin"],
  },
  {
    canonicalKey: "dermal_fillers",
    displayName: "Dermal fillers",
    group: "Injectables",
    synonyms: [
      "dermal filler",
      "dermal fillers",
      "lip filler",
      "cheek filler",
      "tear trough filler",
      "juvederm",
      "restylane",
      "hyaluronic acid filler",
      "filler",
      "fillers",
    ],
  },
  {
    canonicalKey: "biostimulators",
    displayName: "Biostimulators",
    group: "Injectables",
    synonyms: [
      "biostimulator",
      "biostimulators",
      "sculptra",
      "radiesse",
      "collagen stimulator",
    ],
  },
  {
    canonicalKey: "prp",
    displayName: "PRP",
    group: "Injectables",
    synonyms: [
      "prp",
      "platelet-rich plasma",
      "platelet rich plasma",
      "vampire facial",
    ],
  },
  {
    canonicalKey: "prf",
    displayName: "PRF",
    group: "Injectables",
    synonyms: ["prf", "platelet-rich fibrin", "platelet rich fibrin"],
  },
  {
    canonicalKey: "exosomes",
    displayName: "Exosomes",
    group: "Injectables",
    synonyms: ["exosome", "exosomes"],
  },

  // ── Skin care · resurfacing ─────────────────────────────────────────
  {
    canonicalKey: "microneedling",
    displayName: "Microneedling",
    group: "Skin care",
    synonyms: [
      "microneedling",
      "micro-needling",
      "rf microneedling",
      "morpheus",
      "morpheus8",
      "collagen induction",
    ],
  },
  {
    canonicalKey: "chemical_peel",
    displayName: "Chemical peel",
    group: "Skin care",
    synonyms: [
      "chemical peel",
      "glycolic peel",
      "tca peel",
      "salicylic peel",
      "vi peel",
    ],
  },
  {
    canonicalKey: "hydrafacial",
    displayName: "HydraFacial",
    group: "Skin care",
    synonyms: ["hydrafacial", "hydra facial", "hydradermabrasion"],
  },
  {
    canonicalKey: "facial",
    displayName: "Facial",
    group: "Skin care",
    synonyms: [
      "facial",
      "signature facial",
      "bespoke facial",
      "custom facial",
      "european facial",
      "deep cleansing facial",
    ],
  },
  {
    canonicalKey: "photofacial",
    displayName: "Photofacial",
    group: "Skin care",
    synonyms: [
      "photofacial",
      "photo facial",
      "ipl photofacial",
      "bbl photofacial",
      "bbl",
    ],
  },
  {
    canonicalKey: "laser_resurfacing",
    displayName: "Laser resurfacing",
    group: "Skin care",
    synonyms: [
      "laser resurfacing",
      "co2 laser",
      "fraxel",
      "erbium laser",
      "skin resurfacing",
    ],
  },
  {
    canonicalKey: "acne_treatment",
    displayName: "Acne treatment",
    group: "Skin care",
    synonyms: ["acne treatment", "acne facial", "acne therapy"],
  },

  // ── Body · contour ─────────────────────────────────────────────────
  {
    canonicalKey: "laser_hair_removal",
    displayName: "Laser hair removal",
    group: "Body",
    synonyms: [
      "laser hair removal",
      "lhr",
      "laser hair removal service",
      "ipl hair removal",
      "diode laser",
    ],
  },
  {
    canonicalKey: "coolsculpting",
    displayName: "CoolSculpting",
    group: "Body",
    synonyms: [
      "coolsculpting",
      "cryolipolysis",
      "fat reduction",
      "fat freezing",
      "body contouring",
    ],
  },
  {
    canonicalKey: "skin_tightening",
    displayName: "Skin tightening",
    group: "Body",
    synonyms: [
      "skin tightening",
      "ultherapy",
      "ulthera",
      "morpheus rf",
      "rf skin tightening",
      "thermage",
    ],
  },
  {
    canonicalKey: "sclerotherapy",
    displayName: "Sclerotherapy",
    group: "Body",
    synonyms: [
      "sclerotherapy",
      "spider vein",
      "spider veins",
      "varicose vein",
      "vein treatment",
    ],
  },

  // ── Wellness · weight · hormones ────────────────────────────────────
  {
    canonicalKey: "weight_loss",
    displayName: "Medical weight loss",
    group: "Wellness",
    synonyms: [
      "medical weight loss",
      "weight loss",
      "semaglutide",
      "ozempic",
      "wegovy",
      "tirzepatide",
      "mounjaro",
      "glp-1",
      "glp 1",
      "weight loss service",
    ],
  },
  {
    canonicalKey: "hormone_therapy",
    displayName: "Hormone therapy",
    group: "Wellness",
    synonyms: [
      "hormone therapy",
      "hormone replacement",
      "hrt",
      "bhrt",
      "trt",
      "testosterone therapy",
      "bioidentical hormone",
    ],
  },
  {
    canonicalKey: "iv_therapy",
    displayName: "IV therapy",
    group: "Wellness",
    synonyms: [
      "iv therapy",
      "iv drip",
      "vitamin iv",
      "myers cocktail",
      "iv hydration",
    ],
  },

  // ── Permanent makeup · lashes ───────────────────────────────────────
  {
    canonicalKey: "microblading",
    displayName: "Microblading",
    group: "Permanent makeup",
    synonyms: [
      "microblading",
      "permanent makeup",
      "pmu",
      "brow tattoo",
      "powder brow",
      "ombre brow",
    ],
  },
  {
    canonicalKey: "lash_extensions",
    displayName: "Lash extensions",
    group: "Lashes & brows",
    synonyms: [
      "lash extension",
      "lash extensions",
      "eyelash extension",
      "classic lash",
      "volume lash",
      "hybrid lash",
    ],
  },

  // ── Massage ─────────────────────────────────────────────────────────
  {
    canonicalKey: "massage",
    displayName: "Massage",
    group: "Massage",
    synonyms: [
      "massage",
      "deep tissue",
      "swedish massage",
      "swedish",
      "lymphatic drainage",
      "lymph drainage",
      "lymphatic massage",
      "prenatal massage",
    ],
  },
] as const;

/**
 * Return the taxonomy that fits the business's primary or any
 * secondary DfS category. For Phase 1 we only ship med-spa; future
 * verticals add their own files and a switch here.
 *
 * Falls back to an empty taxonomy when nothing matches — service
 * detection then becomes a no-op rather than throwing.
 */
export function pickTaxonomyForCategories(
  categoryIds: readonly string[],
): readonly ServiceTaxonomyEntry[] {
  const set = new Set(categoryIds.map((s) => s.toLowerCase()));
  const MED_SPA_CATEGORIES = [
    "medical_spa",
    "skin_care_clinic",
    "facial_spa",
    "laser_hair_removal_service",
    "day_spa",
    "plastic_surgery_clinic",
    "cosmetic_surgeon",
    "dermatologist",
    "weight_loss_service",
  ];
  for (const c of MED_SPA_CATEGORIES) {
    if (set.has(c)) return MED_SPA_TAXONOMY;
  }
  return [];
}
