/**
 * Service template starter pack + the `ListServiceType` literal union.
 *
 * Relocated here from the (deleted) supply-driven lists module during the
 * agency-portal demand-driven rework. These three exports
 * (`ListServiceTypeValue`, `SERVICE_TEMPLATES`, `SERVICE_TEMPLATE_BY_TYPE`)
 * are the only survivors of `modules/agency-portal/lists/service-templates.ts`
 * + `types.ts` — everything else (lists/list-detail/hunter/prospect) was
 * demolished because there are no users and no backward-compat requirement.
 *
 * Kept because the lean agency onboarding (and any future service-template
 * affordances on the new `/discover` flow) may want a canonical service
 * vocabulary. The label/meta strings are NOT defined here — they live in
 * `messages/{locale}.json` for i18n parity. This module is the canonical
 * ordering + glyph map + `serviceType` mapping only.
 */

/** Mirror of Prisma `ListServiceType` enum · keep these in lock-step. */
export type ListServiceTypeValue =
  | "WEBSITE_REBUILD"
  | "META_ADS_CAMPAIGN"
  | "GOOGLE_ADS_LAUNCH"
  | "LOCAL_SEO"
  | "REVIEW_MANAGEMENT"
  | "BRAND_DEFENSE"
  | "NEW_BUSINESS_LAUNCH"
  | "FULL_AUDIT"
  | "CUSTOM";

export interface ServiceTemplateDescriptor {
  /** Stable kebab-case key (URL-safe). */
  key:
    | "website"
    | "meta_ads"
    | "google_ads"
    | "local_seo"
    | "reviews"
    | "brand"
    | "launch"
    | "audit";
  /** Maps to Prisma `ListServiceType`. */
  serviceType: ListServiceTypeValue;
  /** Glyph (emoji or short string) for the card icon. */
  glyph: string;
  /** Service badge tone token suffix. */
  badgeTone: "web" | "ads" | "seo" | "review" | "brand" | "launch" | "audit";
}

/**
 * Canonical ordering · busiest agency services first (website rebuild,
 * meta ads, local SEO are the highest-revenue retainers); audit last
 * (catch-all, lower frequency).
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
 *
 * `CUSTOM` is NOT in `SERVICE_TEMPLATES` (no quick-start template) — it
 * maps to `undefined`.
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
