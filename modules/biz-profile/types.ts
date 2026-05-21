/**
 * Public business profile · shared types + EMPTY constant.
 *
 * The `BizProfileData` shape is what the `/biz/[slug]` route renders, what
 * `generateMetadata` reads for `<title>` / `<description>` / JSON-LD, and
 * what the NEXT_PHASE build-guard returns when DB access isn't available
 * during Vercel's build worker (per `.claude/rules/cache-components.md`
 * Pattern 1 and INC-27).
 *
 * The shape mirrors the Prisma model's user-facing fields (no internal IDs
 * other than `id`/`slug`) plus the latest `BusinessSnapshot` denormalised
 * onto the same object. If the business has no snapshot yet (most do not at
 * launch — 500 seed businesses, 0 snapshots as of 2026-05-21), every score
 * field is `null` and the page degrades gracefully.
 *
 * `lastSnapshotAt` is the source-of-truth `lastModified` timestamp for both
 * the page's structured data and the sitemap entry. When null, the sitemap
 * falls back to `MARKETING_LAST_MODIFIED`.
 */

export interface BizProfileData {
  /** Stable cuid · used by the JSON-LD `@id`. */
  id: string;
  /** URL slug · matches `Business.slug`. */
  slug: string;
  /** Human-readable business name. */
  name: string;
  /** Primary category slug (e.g. `med_spa`). Plain English rendered downstream. */
  category: string;
  /** Optional address string · displayed in hero. */
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  photosCount: number | null;
  isClaimed: boolean;

  /** Latest snapshot, denormalised. All fields nullable. */
  mapslyScore: number | null;
  msiRank: number | null;
  msiTotal: number | null;
  replyRate: number | null;
  velocityLast30d: number | null;

  /** When the latest snapshot was taken · null if no snapshot exists. */
  lastSnapshotAt: Date | null;
}

/**
 * Shape-complete EMPTY default · returned by the NEXT_PHASE guard so the
 * Vercel build worker can prerender the shell without opening a Neon
 * connection. The page handler treats `id === ""` as "no data, render 404"
 * so build-phase prerenders behave the same as runtime 404s.
 */
export const EMPTY_BIZ_PROFILE: BizProfileData = {
  id: "",
  slug: "",
  name: "",
  category: "",
  address: null,
  city: null,
  province: null,
  country: null,
  postalCode: null,
  lat: null,
  lng: null,
  phone: null,
  website: null,
  rating: null,
  reviewCount: null,
  photosCount: null,
  isClaimed: false,
  mapslyScore: null,
  msiRank: null,
  msiTotal: null,
  replyRate: null,
  velocityLast30d: null,
  lastSnapshotAt: null,
};

/** Minimal slug+lastModified pair used by `app/sitemap.ts` to enumerate URLs. */
export interface BizSitemapEntry {
  slug: string;
  lastModified: Date;
}
