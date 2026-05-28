/**
 * Map `Business.category` strings to the canonical `IndustryKey` used
 * by the local-intent template registry.
 *
 * Categories in our DB are seeded from DfS / Google Maps category
 * strings, which vary in casing + use multiple synonyms for the same
 * concept ("Medical spa" vs "Med spa" vs "Spa"). This mapping is the
 * single source of truth.
 *
 * Unknown categories return `null` — the local-intent pipeline skips
 * those businesses (and process-enhancer flags them so we can extend
 * the mapping).
 */

import type { IndustryKey } from "./templates";

/**
 * Lowercased category → industry. Keys MUST be lowercase · matching
 * is done via `.toLowerCase()` on the input.
 */
const MAPPING: Readonly<Record<string, IndustryKey>> = {
  "medical spa": "medspa",
  "med spa": "medspa",
  medspa: "medspa",
  "skin care clinic": "medspa",
  "aesthetic clinic": "medspa",
  "aesthetics clinic": "medspa",
  "laser hair removal service": "medspa",
  "cosmetic surgeon": "medspa",

  restaurant: "restaurant",
  cafe: "restaurant",
  "coffee shop": "restaurant",
  bistro: "restaurant",

  "auto body shop": "autobody",
  "auto body": "autobody",
  "auto repair shop": "autobody",
  "car repair": "autobody",
  "mechanic shop": "autobody",

  "hair salon": "salon",
  salon: "salon",
  barbershop: "salon",
  "beauty salon": "salon",

  "dental clinic": "dental",
  dentist: "dental",
  orthodontist: "dental",

  gym: "gym",
  "fitness center": "gym",
  "fitness centre": "gym",
  "yoga studio": "gym",
};

export function industryForCategory(category: string | null): IndustryKey | null {
  if (!category) return null;
  const key = category.trim().toLowerCase();
  return MAPPING[key] ?? null;
}
