/**
 * Service auto-detection · Google Business categories → service stubs.
 *
 * Pure function. Takes a Business's primary category + secondary
 * categories[] and proposes a starter list of services. The SMB monthly
 * cron uses this to pre-populate `BusinessService` rows for newly
 * indexed businesses so Maria's first visit to /(smb)/my-business
 * shows something useful — she edits from there rather than starting
 * from a blank page (per the v0.8.x portal restructure decision: "soft
 * onboarding, prefill from Google, user can edit but it's not required").
 *
 * Strategy:
 *
 *   - Google categories are *kinds-of-businesses*, not services. A
 *     "medical_spa" category business sells "Botox", "Lip filler", etc.
 *     So we map the category to a small starter list of services
 *     typical for that vertical.
 *   - The mapping is intentionally conservative (≤ 5 services per
 *     category) so Maria has to ADD specific items rather than DELETE
 *     irrelevant ones — that's a lower-friction onboarding path per
 *     `.claude/rules/ui-ux-smb.md` (one CTA per screen, low cognitive load).
 *   - Categories we don't recognize return an empty list. The cron
 *     skips that business entirely · better silence than noise.
 *
 * To extend: add an entry to `STARTERS_BY_CATEGORY`. Keep entries < 5.
 * Per `.claude/rules/copy-voice.md`, names use the SMB voice — plain
 * English, no jargon. The `category` field groups services for the
 * `/(smb)/my-business` editor's section headings.
 */

export interface SuggestedService {
  /** Display name · plain-English, SMB voice (e.g. "Lip filler"). */
  name: string;
  /** Optional grouping (e.g. "Injectables"). Null when ungrouped. */
  category: string | null;
  /** The raw Google code that produced this suggestion · for logs. */
  sourceHint: string;
}

interface CategoryStarter {
  /** Stable group label used as the `category` field on BusinessService. */
  group: string | null;
  /** Service names · keep ≤ 5 per category to stay friction-low. */
  services: readonly string[];
}

const STARTERS_BY_CATEGORY: Record<string, CategoryStarter> = {
  // Med-spa / aesthetics
  medical_spa: {
    group: "Injectables",
    services: ["Botox", "Lip filler", "Dermal fillers"],
  },
  cosmetic_dentist: {
    group: "Cosmetic dental",
    services: ["Teeth whitening", "Veneers", "Smile makeover"],
  },
  // Beauty + hair
  hair_salon: {
    group: "Hair",
    services: ["Cut", "Color", "Blowout"],
  },
  beauty_salon: {
    group: "Beauty",
    services: ["Facial", "Manicure", "Pedicure"],
  },
  nail_salon: {
    group: "Nails",
    services: ["Manicure", "Pedicure", "Gel polish"],
  },
  barber_shop: {
    group: "Barber",
    services: ["Haircut", "Beard trim", "Hot shave"],
  },
  // Skin / body
  day_spa: {
    group: "Spa",
    services: ["Massage", "Facial", "Body treatment"],
  },
  massage_therapist: {
    group: "Massage",
    services: ["Deep tissue", "Swedish", "Sports massage"],
  },
  laser_hair_removal_service: {
    group: "Hair removal",
    services: ["Laser hair removal"],
  },
  tattoo_shop: {
    group: "Tattoo",
    services: ["Custom tattoo", "Cover-up"],
  },
  // Fitness / wellness
  yoga_studio: {
    group: "Classes",
    services: ["Vinyasa", "Hatha", "Restorative"],
  },
  fitness_center: {
    group: "Training",
    services: ["Personal training", "Group classes"],
  },
  pilates_studio: {
    group: "Classes",
    services: ["Reformer", "Mat pilates"],
  },
  // Health
  chiropractor: {
    group: "Care",
    services: ["Adjustment", "Decompression", "Massage therapy"],
  },
  acupuncture_clinic: {
    group: "Care",
    services: ["Acupuncture", "Cupping"],
  },
  dental_clinic: {
    group: "Dental",
    services: ["Cleaning", "Fillings", "Whitening"],
  },
  // Auto
  auto_body_shop: {
    group: "Repairs",
    services: ["Collision repair", "Paint", "Dent removal"],
  },
  auto_repair_shop: {
    group: "Service",
    services: ["Oil change", "Brake service", "Diagnostics"],
  },
  // Food
  restaurant: {
    group: "Dining",
    services: ["Dine in", "Takeout", "Catering"],
  },
  coffee_shop: {
    group: "Drinks",
    services: ["Espresso", "Pour over", "Pastries"],
  },
  // Home services
  hvac_contractor: {
    group: "Service",
    services: ["AC repair", "Heating", "Installation"],
  },
  plumber: {
    group: "Service",
    services: ["Leak repair", "Drain cleaning", "Water heater"],
  },
  electrician: {
    group: "Service",
    services: ["Wiring", "Panel upgrades", "Lighting"],
  },
};

/**
 * Produce a starter list of services from a business's Google categories.
 *
 * Dedup by service NAME (case-insensitive) — if the primary and a
 * secondary category both contribute "Botox", we emit it once. Order is
 * preserved so the primary category's services land first.
 *
 * Returns an empty list when no categories resolve to a known starter —
 * the cron handler treats that as "skip, nothing to seed."
 */
export function suggestServicesFromGoogleCategories(
  primaryCategory: string | null | undefined,
  categories: readonly string[],
): SuggestedService[] {
  const allCategories = [primaryCategory, ...categories].filter(
    (c): c is string => typeof c === "string" && c.length > 0,
  );

  const seen = new Set<string>();
  const out: SuggestedService[] = [];

  for (const cat of allCategories) {
    const starter = STARTERS_BY_CATEGORY[cat];
    if (!starter) continue;
    for (const name of starter.services) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        category: starter.group,
        sourceHint: cat,
      });
    }
  }

  return out;
}

/**
 * Test-only handle on the mapping table so unit tests can assert size
 * + spot-check entries without re-importing the const.
 */
export const __test = {
  STARTERS_BY_CATEGORY,
};
