/**
 * Public business profile module · barrel.
 *
 * Surfaces:
 *   - Queries (server) — `getBusinessBySlug`, `listBizSitemapEntries`
 *   - Types — `BizProfileData`, `BizSitemapEntry`, `EMPTY_BIZ_PROFILE`
 *   - JSON-LD builder — `buildLocalBusinessSchema`, `bizCanonicalUrl`,
 *     `bizLocalizedPath`
 *   - Formatters — `formatCategory`, `formatLocation`, `formatRatingLine`,
 *     `formatWebsiteDisplay`, `buildMetaDescription`
 *
 * Page handler at `app/[locale]/(marketing)/biz/[slug]/page.tsx` consumes
 * everything here; `app/sitemap.ts` uses `listBizSitemapEntries` +
 * `bizLocalizedPath`.
 */
export {
  EMPTY_BIZ_PROFILE,
  type BizProfileData,
  type BizSitemapEntry,
} from "./types";
export { getBusinessBySlug, listBizSitemapEntries } from "./queries";
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
