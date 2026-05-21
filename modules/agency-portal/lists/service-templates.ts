/**
 * Service template starter pack · the 8 quick-start templates surfaced
 * on the agency lists page top strip.
 *
 * Per `_design/agency/lists.html` and `.claude/rules/ui-ux-agency.md`:
 *
 *   - Tom picks the service he sells → Mapsly pre-fills the matching
 *     filter signals on `/search` (Hunter)
 *   - Each template has a glyph (emoji is acceptable here per
 *     `copy-voice.md` — service-category badges are an allow-listed
 *     emoji surface)
 *   - The "meta" line is the one-liner Tom sees while scanning — should
 *     read as "what does this list find?"
 *
 * The template label/meta strings are NOT defined here — they live in
 * `messages/{locale}.json` under `agency.lists.service_templates.*` for
 * i18n parity. This module is the canonical ordering + glyph map only.
 *
 * Used by:
 *   - `<ServiceTemplateStrip>` on `/(agency)/lists`
 *   - (future) Hunter `/search?template=<key>` deep-link prefill (F.2)
 */

import type { ListServiceTypeValue } from "./types";

export interface ServiceTemplateDescriptor {
  /** Stable kebab-case key (URL-safe, used for /search?template={key}). */
  key:
    | "website"
    | "meta_ads"
    | "google_ads"
    | "local_seo"
    | "reviews"
    | "brand"
    | "launch"
    | "audit";
  /** Maps to Prisma `ListServiceType` for the eventual save-as-list. */
  serviceType: ListServiceTypeValue;
  /** Glyph (emoji or short string) for the card icon. */
  glyph: string;
  /** Service badge tone token suffix, used by `ListCard` palette. */
  badgeTone: "web" | "ads" | "seo" | "review" | "brand" | "launch" | "audit";
}

/**
 * Canonical ordering · also the iteration order on the strip.
 *
 * The order is intentional — busiest agency services first (website
 * rebuild, meta ads, local SEO are the highest-revenue retainers per
 * the agency-product-audit reference). Audit goes last (catch-all,
 * lower frequency).
 */
export const SERVICE_TEMPLATES: readonly ServiceTemplateDescriptor[] = [
  {
    key: "website",
    serviceType: "WEBSITE_REBUILD",
    glyph: "🌐",
    badgeTone: "web",
  },
  {
    key: "meta_ads",
    serviceType: "META_ADS_CAMPAIGN",
    glyph: "📣",
    badgeTone: "ads",
  },
  {
    key: "google_ads",
    serviceType: "GOOGLE_ADS_LAUNCH",
    glyph: "🎯",
    badgeTone: "ads",
  },
  { key: "local_seo", serviceType: "LOCAL_SEO", glyph: "🔍", badgeTone: "seo" },
  {
    key: "reviews",
    serviceType: "REVIEW_MANAGEMENT",
    glyph: "⭐",
    badgeTone: "review",
  },
  {
    key: "brand",
    serviceType: "BRAND_DEFENSE",
    glyph: "🛡️",
    badgeTone: "brand",
  },
  {
    key: "launch",
    serviceType: "NEW_BUSINESS_LAUNCH",
    glyph: "🆕",
    badgeTone: "launch",
  },
  { key: "audit", serviceType: "FULL_AUDIT", glyph: "📊", badgeTone: "audit" },
] as const;

/**
 * Lookup table · maps Prisma `ListServiceType` → template descriptor.
 * Used by `ListCard` to render the service badge for an existing list.
 *
 * Note `CUSTOM` is NOT in `SERVICE_TEMPLATES` (no quick-start template)
 * — it falls through to the catch-all "audit" tone in `ListCard`.
 */
export const SERVICE_TEMPLATE_BY_TYPE: Readonly<
  Record<ListServiceTypeValue, ServiceTemplateDescriptor | undefined>
> = Object.freeze({
  WEBSITE_REBUILD: SERVICE_TEMPLATES[0],
  META_ADS_CAMPAIGN: SERVICE_TEMPLATES[1],
  GOOGLE_ADS_LAUNCH: SERVICE_TEMPLATES[2],
  LOCAL_SEO: SERVICE_TEMPLATES[3],
  REVIEW_MANAGEMENT: SERVICE_TEMPLATES[4],
  BRAND_DEFENSE: SERVICE_TEMPLATES[5],
  NEW_BUSINESS_LAUNCH: SERVICE_TEMPLATES[6],
  FULL_AUDIT: SERVICE_TEMPLATES[7],
  CUSTOM: undefined,
});
