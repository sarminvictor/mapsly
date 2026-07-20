/**
 * Public business profile module · barrel.
 *
 * Surfaces:
 *   - Queries (server) — `getBusinessBySlug`, `listBizSitemapEntries`
 *   - SEO gate — `passesBizIndexGate`, `SITEMAP_CANDIDATE_WHERE`
 *   - Types — `BizProfileData`, `BizSitemapEntry`, `EMPTY_BIZ_PROFILE`
 *   - JSON-LD builder — `buildLocalBusinessSchema`, `bizCanonicalUrl`,
 *     `bizLocalizedPath`
 *   - Formatters — `formatCategory`, `formatLocation`, `formatRatingLine`,
 *     `formatWebsiteDisplay`, `buildMetaDescription`
 *
 * Page handler at `app/[locale]/(marketing)/biz/[slug]/page.tsx` consumes
 * everything here; `app/sitemap.xml/route.ts` uses `listBizSitemapEntries` +
 * `bizLocalizedPath` (via `lib/seo/sitemap-xml.ts`).
 */
export {
  EMPTY_BIZ_PROFILE,
  type BizProfileData,
  type BizSitemapEntry,
} from "./types";
export { getBusinessBySlug, listBizSitemapEntries } from "./queries";
export {
  passesBizIndexGate,
  SITEMAP_CANDIDATE_WHERE,
  BIZ_INDEX_MIN_REVIEWS,
  type BizIndexGateInput,
} from "./seo-gate";
export {
  buildLocalBusinessSchema,
  bizCanonicalUrl,
  bizLocalizedPath,
  type LocalBusinessSchema,
} from "./json-ld";
export {
  formatCategory,
  formatLocation,
  formatRatingLine,
  formatWebsiteDisplay,
  buildMetaDescription,
} from "./format";
