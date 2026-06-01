/**
 * Local-intent keyword templates per industry.
 *
 * Replaces the legacy `ranked_keywords` portfolio source for the SMB
 * /search page (per architecture decision C, 2026-05-28). Maria's
 * customers don't search what Google decided to rank her for —
 * they search by category + city + service. This module is the
 * canonical source of what those searches look like.
 *
 * Adding an industry:
 *   1. Add entry to INDUSTRY_TEMPLATES below
 *   2. Add the matching `Business.category` strings in
 *      `category-to-industry.ts`
 *   3. The pipeline (discover-local-intent + aggregate-cell-maps)
 *      will pick up new industries on the next weekly cron tick
 *
 * Template strings use {city} placeholder. `fillCityTemplate`
 * lowercases the city name for consistency with how Google
 * normalises local queries.
 *
 * Service templates ride on a `services-detect` flag (the integration
 * lands in S.7; for now we ship the core list per industry and a
 * generous default-on service list for medspa since that's the only
 * industry with a real test business yet).
 */

import type { Locale } from "@/i18n/routing";

export type IndustryKey =
  | "medspa"
  | "restaurant"
  | "autobody"
  | "salon"
  | "dental"
  | "gym";

export interface IndustryTemplates {
  /** Always-on keywords for this industry. Maria sees these regardless
   *  of which services-detect flags fire. */
  core: readonly string[];
  /** Service-flag-gated keywords. Key is the boolean flag the
   *  services-detect cron output is expected to set; value is the
   *  template. Until services-detect lands (S.7), all listed services
   *  are treated as "on" to maximise scan coverage. */
  service: Readonly<Record<string, string>>;
}

/**
 * Per-industry template registry. Maintained by hand · expanding it
 * is a one-file change. Keep entries lowercase + free of accents so
 * that Google's case-insensitive matching gives consistent results.
 */
export const INDUSTRY_TEMPLATES: Readonly<
  Record<IndustryKey, IndustryTemplates>
> = {
  medspa: {
    core: [
      "med spa {city}",
      "medical spa {city}",
      "botox {city}",
      "best med spa {city}",
      "medspa near me",
    ],
    service: {
      hasFillers: "dermal fillers {city}",
      hasLipFillers: "lip injections {city}",
      hasMicroneedling: "microneedling {city}",
      hasLaserHair: "laser hair removal {city}",
      hasBodySculpting: "body sculpting {city}",
      hasBelkyra: "belkyra {city}",
      hasCoolsculpting: "coolsculpting {city}",
    },
  },
  restaurant: {
    // S.6 stub · expand when first restaurant onboards
    core: [],
    service: {},
  },
  autobody: {
    core: [],
    service: {},
  },
  salon: {
    core: [],
    service: {},
  },
  dental: {
    core: [],
    service: {},
  },
  gym: {
    core: [],
    service: {},
  },
} as const;

/**
 * Replace the {city} placeholder in a template with the actual city
 * name. Lowercases everything for consistency with how Google
 * normalises local queries. "near me" templates have no placeholder
 * and pass through unchanged.
 */
export function fillCityTemplate(template: string, city: string): string {
  return template
    .replace("{city}", city)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tag identifying which template bucket produced a given keyword.
 * Stored on `BusinessKeyword.templateOrigin` so the UI can surface
 * the "your service" badge per Boxly's pattern.
 */
export type TemplateOrigin = "core" | "service";

export interface ExpandedKeyword {
  /** The keyword as it will be queried against DfS · lowercased,
   *  city-filled. */
  keyword: string;
  /** Which bucket this came from · used for the "your service" badge. */
  origin: TemplateOrigin;
}

/**
 * Build the canonical local-intent keyword set for one business.
 *
 *   - `industry` selects the template bucket
 *   - `city` fills the {city} placeholder
 *   - `serviceFlags` gates the service bucket · keys are the same as
 *     the keys in `templates.service` (e.g. `hasBelkyra`). Pass `null`
 *     to enable EVERY service template (the current "services-detect
 *     not yet integrated" behaviour, S.7 will pass real flags)
 *
 * Locale parameter is reserved for S.6.1 · for now everything is
 * en-US wording. Returns deduplicated, lowercase keywords.
 */
export function expandTemplatesForBusiness(input: {
  industry: IndustryKey;
  city: string;
  serviceFlags: Readonly<Record<string, boolean>> | null;
  locale?: Locale;
}): ExpandedKeyword[] {
  const templates = INDUSTRY_TEMPLATES[input.industry];
  const out: ExpandedKeyword[] = [];

  for (const t of templates.core) {
    out.push({ keyword: fillCityTemplate(t, input.city), origin: "core" });
  }

  for (const [flag, template] of Object.entries(templates.service)) {
    const enabled = input.serviceFlags == null || input.serviceFlags[flag];
    if (!enabled) continue;
    out.push({
      keyword: fillCityTemplate(template, input.city),
      origin: "service",
    });
  }

  // Dedup · same keyword from multiple buckets keeps the first origin
  // (core wins over service so the badge doesn't lie).
  const seen = new Map<string, ExpandedKeyword>();
  for (const k of out) {
    if (!seen.has(k.keyword)) seen.set(k.keyword, k);
  }
  return Array.from(seen.values());
}
