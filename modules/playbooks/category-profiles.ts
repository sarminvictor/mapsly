// modules/playbooks/category-profiles.ts · per-vertical CategoryProfile data
// (§4.15)
//
// A CategoryProfile carries the human-facing, code-versioned knowledge for a
// vertical that the playbook detectors (deterministic rules) do NOT: the
// audience VOCABULARY, the REGULATIONS that frame pitches, the BENCHMARKS Tom
// quotes, and the PITCH NUANCES that make outreach land. It is code-versioned
// (the source of truth lives here, not in the DB) and SEEDED into the
// `CategoryProfile` table so the agency UI + cron can read it without importing
// app code.
//
// seedCategoryProfiles() upserts each profile idempotently on the
// @@unique([categorySlug, version]) compound key — re-running refreshes the row
// in place, never duplicates.
//
// See:
//   - prisma/schema.prisma          — model CategoryProfile
//   - modules/playbooks/registry.ts — the 5 launch playbooks these profile
//   - .claude/rules/copy-voice.md   — agency vs SMB vocabulary

import prisma, { Prisma } from "@/lib/prisma";

/** A vertical's vocabulary — the words to use (and avoid) for each audience. */
export interface CategoryVocabulary {
  /** What the SMB calls their customers (e.g. "patients", "guests"). */
  readonly customerNoun: string;
  /** What the SMB calls their offerings (e.g. "treatments", "menu items"). */
  readonly serviceNoun: string;
  /** What the SMB calls their staff (e.g. "providers", "techs"). */
  readonly staffNoun: string;
  /** Agency-facing jargon that is welcome for this vertical. */
  readonly agencyTerms: readonly string[];
}

/** One regulation reference framing this vertical's pitches. */
export interface CategoryRegulation {
  readonly name: string;
  readonly scope: "federal" | "state" | "local";
  readonly summary: string;
  /** True when the legal theory is unsettled (copy must hedge). */
  readonly contested?: boolean;
}

/** Quotable benchmarks for this vertical (national defaults; cell overrides). */
export interface CategoryBenchmarks {
  /** Typical owner reply rate on reviews (0–1). */
  readonly replyRate: number;
  /** Typical Google rating. */
  readonly rating: number;
  /** Typical review count for an established business. */
  readonly reviewCount: number;
  /** Share of the cell that runs paid ads (0–1). */
  readonly adPrevalence: number;
}

/** Pitch-nuance notes the agency outreach layer reads. */
export interface CategoryPitchNuances {
  /** The single strongest opening angle for this vertical. */
  readonly headline: string;
  /** Angles that resonate, in priority order. */
  readonly resonates: readonly string[];
  /** Angles that fall flat / feel off for this audience. */
  readonly avoid: readonly string[];
}

/** The full code-versioned profile for one vertical. */
export interface CategoryProfileData {
  readonly categorySlug: string;
  readonly displayName: string;
  readonly version: number;
  readonly vocabulary: CategoryVocabulary;
  readonly regulations: readonly CategoryRegulation[];
  readonly benchmarks: CategoryBenchmarks;
  readonly pitchNuances: CategoryPitchNuances;
}

/**
 * The launch-set category profiles, keyed by the playbook id they pair with.
 * Slugs match the primary categorySlug of each playbook so the two layers line
 * up (a business resolving to the `med-spa` playbook reads the `med-spa`
 * profile).
 */
export const CATEGORY_PROFILES: Readonly<Record<string, CategoryProfileData>> =
  Object.freeze({
    "med-spa": {
      categorySlug: "med-spa",
      displayName: "Med spa",
      version: 1,
      vocabulary: {
        customerNoun: "patients",
        serviceNoun: "treatments",
        staffNoun: "providers",
        agencyTerms: [
          "HIPAA",
          "PHI",
          "medical director",
          "before/after claims",
        ],
      },
      regulations: [
        {
          name: "HIPAA Online Tracking (OCR)",
          scope: "federal",
          summary:
            "Trackers on PHI pages may disclose patient data; the federal theory is contested post AHA v. HHS (2024).",
          contested: true,
        },
        {
          name: "Medical-director / physician-supervision disclosure",
          scope: "state",
          summary:
            "Several states require med-spas offering injectables to disclose a supervising physician on-site and online.",
        },
        {
          name: "ADA Title III (web accessibility)",
          scope: "federal",
          summary:
            "Health/beauty sites are frequent ADA web-accessibility demand-letter targets.",
        },
      ],
      benchmarks: {
        replyRate: 0.89,
        rating: 4.6,
        reviewCount: 180,
        adPrevalence: 0.55,
      },
      pitchNuances: {
        headline:
          "A tracker shares their site with patient-intake forms — a privacy review point.",
        resonates: [
          "patient privacy / HIPAA exposure",
          "reputation recovery after a complaint cluster",
          "before/after claim substantiation",
        ],
        avoid: ["aggressive 'you are breaking the law' framing"],
      },
    },
    hvac: {
      categorySlug: "hvac",
      displayName: "HVAC",
      version: 1,
      vocabulary: {
        customerNoun: "homeowners",
        serviceNoun: "jobs",
        staffNoun: "technicians",
        agencyTerms: [
          "EPA 608",
          "state contractor license",
          "conversion tracking",
          "LSA",
        ],
      },
      regulations: [
        {
          name: "State contractor licensing (HVAC / mechanical)",
          scope: "state",
          summary:
            "Most states license HVAC contractors; many require the license number on advertising.",
        },
        {
          name: "EPA Section 608 technician certification",
          scope: "federal",
          summary:
            "Technicians handling refrigerants must hold EPA 608 certification.",
        },
      ],
      benchmarks: {
        replyRate: 0.6,
        rating: 4.5,
        reviewCount: 120,
        adPrevalence: 0.7,
      },
      pitchNuances: {
        headline:
          "They run ads but track no conversions — spend they can't attribute to booked jobs.",
        resonates: [
          "wasted ad spend / no attribution",
          "online booking to capture after-hours calls",
          "license-display trust",
        ],
        avoid: ["jargon-heavy SEO talk with no dollar outcome"],
      },
    },
    dental: {
      categorySlug: "dental",
      displayName: "Dental",
      version: 1,
      vocabulary: {
        customerNoun: "patients",
        serviceNoun: "procedures",
        staffNoun: "providers",
        agencyTerms: [
          "HIPAA",
          "PHI",
          "dental-board ad rules",
          "new-patient acquisition",
        ],
      },
      regulations: [
        {
          name: "HIPAA Online Tracking (OCR)",
          scope: "federal",
          summary:
            "Dental practices are covered entities; trackers on PHI pages may disclose patient data (contested post AHA v. HHS).",
          contested: true,
        },
        {
          name: "State dental-board advertising rules",
          scope: "state",
          summary:
            "Specialty / 'specialist' claims are generally restricted to credential-holders.",
        },
      ],
      benchmarks: {
        replyRate: 0.72,
        rating: 4.7,
        reviewCount: 200,
        adPrevalence: 0.6,
      },
      pitchNuances: {
        headline:
          "A tracker shares their site with patient-intake forms — a privacy review point.",
        resonates: [
          "patient privacy / HIPAA exposure",
          "new-patient online scheduling",
          "specialty-claim ad compliance",
        ],
        avoid: ["definitive legal accusations"],
      },
    },
    restaurant: {
      categorySlug: "restaurant",
      displayName: "Restaurant",
      version: 1,
      vocabulary: {
        customerNoun: "guests",
        serviceNoun: "menu items",
        staffNoun: "servers",
        agencyTerms: [
          "ADA",
          "online ordering",
          "allergen disclosure",
          "first-party revenue",
        ],
      },
      regulations: [
        {
          name: "ADA Title III (web accessibility)",
          scope: "federal",
          summary:
            "Restaurants are the single most common ADA web-accessibility demand-letter target.",
        },
        {
          name: "Allergen disclosure (CA SB-68 and similar)",
          scope: "state",
          summary:
            "A growing set of jurisdictions expect allergen / dietary info on menus.",
        },
      ],
      benchmarks: {
        replyRate: 0.45,
        rating: 4.3,
        reviewCount: 350,
        adPrevalence: 0.4,
      },
      pitchNuances: {
        headline:
          "Inaccessible site = the #1 ADA suit target; no first-party online ordering = lost revenue.",
        resonates: [
          "ADA web-accessibility risk",
          "recovering commission paid to delivery aggregators",
          "allergen-disclosure liability",
        ],
        avoid: ["assuming they have a marketing budget for retainers up-front"],
      },
    },
    "auto-body": {
      categorySlug: "auto-body",
      displayName: "Auto body",
      version: 1,
      vocabulary: {
        customerNoun: "customers",
        serviceNoun: "repairs",
        staffNoun: "technicians",
        agencyTerms: [
          "BAR registration",
          "I-CAR / Gold Class",
          "OEM cert",
          "estimate request",
        ],
      },
      regulations: [
        {
          name: "State auto-repair shop registration (e.g. CA BAR)",
          scope: "state",
          summary:
            "Body shops register with the state; the registration number is commonly expected on marketing.",
        },
        {
          name: "EPA refinish NESHAP + VOC limits",
          scope: "federal",
          summary:
            "Collision-refinishing is subject to EPA Area Source NESHAP (6H) and VOC limits.",
        },
      ],
      benchmarks: {
        replyRate: 0.5,
        rating: 4.4,
        reviewCount: 90,
        adPrevalence: 0.45,
      },
      pitchNuances: {
        headline:
          "No online estimate request + no surfaced I-CAR/OEM cert = lost high-intent leads.",
        resonates: [
          "online estimate-request capture",
          "I-CAR / OEM certification trust signals",
          "registration-display credibility",
        ],
        avoid: ["over-promising rankings without a conversion path"],
      },
    },
  });

/** Outcome of a seed run, for cron telemetry. */
export interface SeedCategoryProfilesOutcome {
  upserted: number;
}

/**
 * Upsert every launch-set CategoryProfile into the DB. Idempotent on the
 * @@unique([categorySlug, version]) compound key — a re-run refreshes the row's
 * JSON in place rather than inserting a duplicate. The code map is the source of
 * truth; the DB row is a read-through cache for the UI + cron.
 */
export async function seedCategoryProfiles(): Promise<SeedCategoryProfilesOutcome> {
  let upserted = 0;
  for (const profile of Object.values(CATEGORY_PROFILES)) {
    const data = {
      displayName: profile.displayName,
      vocabulary: profile.vocabulary as unknown as Prisma.InputJsonValue,
      regulations: profile.regulations as unknown as Prisma.InputJsonValue,
      benchmarks: profile.benchmarks as unknown as Prisma.InputJsonValue,
      pitchNuances: profile.pitchNuances as unknown as Prisma.InputJsonValue,
    };
    await prisma.categoryProfile.upsert({
      where: {
        categorySlug_version: {
          categorySlug: profile.categorySlug,
          version: profile.version,
        },
      },
      create: {
        categorySlug: profile.categorySlug,
        version: profile.version,
        ...data,
      },
      update: data,
    });
    upserted += 1;
  }
  return { upserted };
}
