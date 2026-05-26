/**
 * Curated registry of business categories Mapsly tracks.
 *
 * Sourced from `_design/local-intel-preplan.md` § 3.1 (niche-scoring
 * table) and § 11 (phased build plan). Every entry is a real
 * DataForSEO Maps category string — running a `mapsSearch` with
 * `categories: [dataforseoId]` against a populated metro should
 * always yield rows.
 *
 * The admin picks from this list when adding a `BusinessCategory` to
 * the registry. We don't allow free-text — only verticals from the
 * plan enter the catalog. New verticals require a code change here so
 * additions are deliberate and reviewed.
 *
 * Phase column tracks our launch sequencing per preplan § 3.2:
 *   - Phase 1 (M1–2): med spa · 4 metros · ~5k businesses
 *   - Phase 2 (M3–4): + HVAC, Real Estate · top 8 metros · ~50k
 *   - Phase 3 (M5–6): + chiro, vet, roofing · top 15 metros · ~150k
 *   - Phase 4 (M7–9): + plumbing, auto, dental, landscaping · top 30 · ~400k
 *   - Phase 5 (M10–12): remaining 8 verticals · full 65 metros · ~2M
 *
 * Score is the niche-scoring index (1-100) from preplan § 3.1.
 */

export type LaunchPhase = 1 | 2 | 3 | 4 | 5;

export interface KnownCategory {
  /** DataForSEO Maps category slug — passed as `categories` to mapsSearch. */
  dataforseoId: string;
  /** Human-friendly label rendered in the admin UI. */
  label: string;
  /** Optional meta-group for visual grouping (e.g. "beauty_and_wellness"). */
  groupKey: string;
  /** Plan phase this vertical lands in (preplan § 3.2). */
  phase: LaunchPhase;
  /** Niche score from preplan § 3.1 — higher is more attractive. */
  score: number;
}

/**
 * The curated list. Phase 1 is the only one seeded as a real
 * `BusinessCategory` row in `seed-discovery-registry.ts`; the rest
 * are pickable in the admin UI to opt in when ready.
 */
export const KNOWN_CATEGORIES: readonly KnownCategory[] = [
  // Phase 1 · launch vertical
  {
    dataforseoId: "medical_spa",
    label: "Medical Spa",
    groupKey: "beauty_and_wellness",
    phase: 1,
    score: 79,
  },

  // Phase 2 · M3–4
  {
    dataforseoId: "real_estate_agency",
    label: "Real Estate Agency",
    groupKey: "professional_services",
    phase: 2,
    score: 74,
  },
  {
    dataforseoId: "hvac_contractor",
    label: "HVAC Contractor",
    groupKey: "home_services",
    phase: 2,
    score: 70,
  },

  // Phase 3 · M5–6
  {
    dataforseoId: "chiropractor",
    label: "Chiropractor",
    groupKey: "health",
    phase: 3,
    score: 69,
  },
  {
    dataforseoId: "veterinary_care",
    label: "Veterinary Care",
    groupKey: "health",
    phase: 3,
    score: 69,
  },
  {
    dataforseoId: "roofing_contractor",
    label: "Roofing Contractor",
    groupKey: "home_services",
    phase: 3,
    score: 68,
  },

  // Phase 4 · M7–9
  {
    dataforseoId: "plumber",
    label: "Plumber",
    groupKey: "home_services",
    phase: 4,
    score: 68,
  },
  {
    dataforseoId: "auto_repair_shop",
    label: "Auto Repair Shop",
    groupKey: "automotive",
    phase: 4,
    score: 67,
  },
  {
    dataforseoId: "landscaper",
    label: "Landscaper",
    groupKey: "home_services",
    phase: 4,
    score: 65,
  },
  {
    dataforseoId: "dental_clinic",
    label: "Dental Clinic",
    groupKey: "health",
    phase: 4,
    score: 63,
  },

  // Phase 5 · M10–12 (kept curated; expand here as plan evolves)
  {
    dataforseoId: "personal_injury_attorney",
    label: "Personal Injury Attorney",
    groupKey: "professional_services",
    phase: 5,
    score: 61,
  },
  {
    dataforseoId: "restaurant",
    label: "Restaurant",
    groupKey: "food_and_dining",
    phase: 5,
    score: 57,
  },
  {
    dataforseoId: "hair_salon",
    label: "Hair Salon",
    groupKey: "beauty_and_wellness",
    phase: 5,
    score: 60,
  },
  {
    dataforseoId: "nail_salon",
    label: "Nail Salon",
    groupKey: "beauty_and_wellness",
    phase: 5,
    score: 58,
  },
  {
    dataforseoId: "beauty_salon",
    label: "Beauty Salon",
    groupKey: "beauty_and_wellness",
    phase: 5,
    score: 58,
  },
] as const;

/** Index lookup by DataForSEO ID. Throws if absent — admin UI prevents free text. */
export function getKnownCategory(dataforseoId: string): KnownCategory {
  const entry = KNOWN_CATEGORIES.find((c) => c.dataforseoId === dataforseoId);
  if (!entry) {
    throw new Error(
      `Unknown category "${dataforseoId}". Add it to known-categories.ts first.`,
    );
  }
  return entry;
}

/**
 * Launch cities for Phase 1 — Med Spa across the 4 metros per
 * preplan § 11.1 W2. These get pre-seeded as `TrackedLocation` rows
 * by `scripts/seed-discovery-registry.ts`.
 *
 * Coordinates target the metro centroid; admin can refine via the
 * /admin/discovery page if needed.
 */
export interface LaunchCity {
  city: string;
  province: string;
  country: "US" | "CA";
  lat: number;
  lng: number;
  radiusKm: number;
}

export const PHASE_1_LAUNCH_CITIES: readonly LaunchCity[] = [
  {
    city: "Los Angeles",
    province: "CA",
    country: "US",
    lat: 34.0522,
    lng: -118.2437,
    radiusKm: 10,
  },
  {
    city: "Miami",
    province: "FL",
    country: "US",
    lat: 25.7617,
    lng: -80.1918,
    radiusKm: 10,
  },
  {
    city: "Phoenix",
    province: "AZ",
    country: "US",
    lat: 33.4484,
    lng: -112.074,
    radiusKm: 10,
  },
  {
    city: "Toronto",
    province: "ON",
    country: "CA",
    lat: 43.6532,
    lng: -79.3832,
    radiusKm: 10,
  },
] as const;
