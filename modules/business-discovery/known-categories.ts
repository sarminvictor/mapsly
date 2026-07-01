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

import { CURATED_CATEGORIES } from "./curated-categories.generated";

export type LaunchPhase = 1 | 2 | 3 | 4 | 5;

export interface KnownCategory {
  /** DataForSEO Maps category slug — passed as `categories` to mapsSearch. */
  dataforseoId: string;
  /** Human-friendly label rendered in the admin UI. */
  label: string;
  /** Optional meta-group for visual grouping (e.g. "beauty_and_wellness"). */
  groupKey: string;
  /** Plan phase this vertical lands in (preplan § 3.2). Optional — the curated
   *  US+CA catalog (curated-categories.generated.ts) omits it; only the original
   *  launch verticals carry one. */
  phase?: LaunchPhase;
  /** Niche score from preplan § 3.1 — higher is more attractive. Optional for
   *  the same reason as `phase`. */
  score?: number;
}

/**
 * The curated catalog — the full DfS-verified US + Canada local-business set
 * (curated-categories.generated.ts, sourced from the DfS category CSV). The
 * agency Market step + admin discovery both read this; the seed upserts every
 * entry into BusinessCategory.
 */
export const KNOWN_CATEGORIES: readonly KnownCategory[] = CURATED_CATEGORIES;

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
