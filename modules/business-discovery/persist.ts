/**
 * Shared persistence for DataForSEO Maps → Business rows.
 *
 * Single source of truth for the (rowToShape · dedup-by-CID · mint-slug ·
 * create) sequence. Previously lived inside the retired
 * `daily/indexer-new-businesses` cron. Now used by:
 *   - `/admin/discovery` runs (action: `runDiscovery`)
 *   - Future SMB onboarding self-claim
 *   - Future Hunter "expand to Google" affordance
 *
 * Every caller passes a `source` literal so we know which path created
 * the row. See `BusinessSource` enum in `prisma/schema.prisma`.
 */

import prisma, { Prisma } from "@/lib/prisma";
import { cleanWebsiteUrl } from "@/lib/url/clean-website-url";

import type { MapsBusinessRow } from "@/services/dataforseo/maps-search";

/**
 * Mirror of Prisma `BusinessSource` enum · keep in lock-step with
 * `schema.prisma`. We keep the literal union local instead of
 * importing Prisma's generated type per `.claude/rules/conventions.md`
 * (same pattern as `LeadStatusValue`).
 */
export type BusinessSourceValue =
  | "DISCOVERY"
  | "MANUAL_SEED"
  | "ONBOARDING"
  | "HUNTER_EXPAND";

/**
 * Result of normalising one DataForSEO row into the shape required by
 * `prisma.business.create`. Null when the minimum identity (`name` +
 * either `cid` or `placeId`) is missing — caller should skip those.
 *
 * Every typed field below has a matching column on `Business` and a
 * Json source field on the original row. `sourceRawJson` carries the
 * entire raw payload so future fields DfS adds can be back-extracted
 * without re-running discovery.
 */
export interface PersistShape {
  // Identity
  name: string;
  originalTitle: string | null;
  featureId: string | null;
  googleCid: string | null;
  googlePlaceId: string | null;

  // Categories
  category: string; // display name (primary)
  categories: string[]; // display names (additional, up to 10)
  categoryIds: string[]; // DfS slugs (full list, no cap)

  // Location
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  snippet: string | null;

  // Contact
  phone: string | null;
  website: string | null;
  domain: string | null;
  contactInfo: Prisma.InputJsonValue | undefined;

  // Visuals
  logoUrl: string | null;
  mainImageUrl: string | null;
  photosCount: number | null;

  // Ratings + behavior
  rating: number | null;
  reviewCount: number | null;
  ratingDistribution: Prisma.InputJsonValue | undefined;
  isClaimed: boolean;

  // Rich nested payloads (Json) · undefined skips the column on insert
  // (DB defaults to NULL since columns are nullable). Prisma rejects
  // `null` literal on Json fields — use `Prisma.JsonNull` only when an
  // explicit NULL must override an existing value.
  description: string | null;
  attributes: Prisma.InputJsonValue | undefined;
  hours: Prisma.InputJsonValue | undefined;
  placeTopics: Prisma.InputJsonValue | undefined;
  peopleAlsoSearch: Prisma.InputJsonValue | undefined;
  popularTimes: Prisma.InputJsonValue | undefined;
  localBusinessLinks: Prisma.InputJsonValue | undefined;

  // Provenance
  checkUrl: string | null;
  firstSeenOnGoogle: Date | null; // DfS's first_seen
  sourceLastUpdatedAt: Date | null; // DfS's last_updated_time
  sourceRawJson: Prisma.InputJsonValue; // entire row, untyped

  // Cell membership + discovery-time status — stamped by the demand-discovery
  // runner (run-discovery.refetchCell) before persisting. Optional because the
  // admin qualify path persists rows without them.
  cellKey?: string;
  metroSlug?: string;
  // Mirrors the BusinessOpenStatus enum (string-literal union keeps this module
  // import-free of the generated Prisma enum while staying assignable to it).
  openStatus?:
    | "OPEN"
    | "CLOSED"
    | "TEMPORARILY_CLOSED"
    | "CLOSED_FOREVER"
    | "UNKNOWN";
  anchorDistanceKm?: number | null;
  crossMetroDupe?: boolean;
}

/**
 * Geo defaults · used when DfS omits address fields on a row. Comes from
 * the discovery cell that captured the row — if the business showed up
 * in a (Calgary, 10km) query but DfS didn't tag its city, "Calgary" is
 * the right inference (and it makes the qualify-cell filter find it).
 */
export interface PersistFallbacks {
  city: string | null;
  province: string | null;
  country: string | null;
}

/**
 * Map a raw DataForSEO Maps row → Business insert shape. Returns null
 * when the row lacks both `cid` and `place_id` (we wouldn't be able to
 * dedup it). Caller chains this into `persistBusinessRow` below.
 *
 * Every DfS field that ships in the response is captured — typed
 * columns for the ones we'll query, plus `sourceRawJson` for the
 * complete row so nothing is lost.
 *
 * `fallbacks` provides geo defaults (city, province, country) for rows
 * where DfS omits those fields — happens ~5-10% of the time on mobile-
 * service or recently-created listings. The cell's own geo applies
 * because the business is in our index only because it matched the
 * cell's (coord, radius) query.
 *
 * Backwards-compatible: a single-string second argument is still
 * accepted as the country fallback (legacy signature from when only
 * country had a default).
 */
export function mapsRowToPersist(
  row: MapsBusinessRow,
  fallbacks: PersistFallbacks | string | null,
): PersistShape | null {
  const fb: PersistFallbacks =
    typeof fallbacks === "object" && fallbacks !== null
      ? fallbacks
      : { city: null, province: null, country: fallbacks ?? null };

  const name = row.title ?? null;
  if (!name) return null;
  const cid = row.cid ?? null;
  const placeId = row.place_id ?? null;
  if (!cid && !placeId) return null;

  return {
    // Identity
    name,
    originalTitle: row.original_title ?? null,
    featureId: row.feature_id ?? null,
    googleCid: cid,
    googlePlaceId: placeId,

    // Categories
    category: row.category ?? "uncategorized",
    categories:
      Array.isArray(row.additional_categories) &&
      row.additional_categories.length
        ? row.additional_categories.slice(0, 10)
        : [],
    categoryIds:
      Array.isArray(row.category_ids) && row.category_ids.length
        ? [...row.category_ids]
        : [],

    // Location · fall back to cell's geo when DfS omits these. The
    // business is in our index because it matched the cell's (coord,
    // radius) query, so the cell's city/province/country is a sound
    // inference. Without this fallback, ~5-10% of rows persist with
    // null city, breaking the qualify-cell exact-match filter.
    address: row.address ?? row.address_info?.address ?? null,
    city: row.address_info?.city ?? fb.city ?? null,
    province: row.address_info?.region ?? fb.province ?? null,
    country: (row.address_info?.country_code ?? fb.country ?? "US")
      .toUpperCase()
      .slice(0, 3),
    postalCode: row.address_info?.zip ?? null,
    lat: typeof row.latitude === "number" ? row.latitude : null,
    lng: typeof row.longitude === "number" ? row.longitude : null,
    snippet: row.snippet ?? null,

    // Contact
    phone: row.phone ?? null,
    // Strip GMB/UTM tracking params — store the canonical link only.
    website: cleanWebsiteUrl(row.url),
    domain: row.domain ?? null,
    contactInfo: asJson(row.contact_info),

    // Visuals
    logoUrl: row.logo ?? null,
    mainImageUrl: row.main_image ?? null,
    photosCount: typeof row.total_photos === "number" ? row.total_photos : null,

    // Ratings + behavior
    rating: row.rating?.value ?? null,
    reviewCount: row.rating?.votes_count ?? null,
    ratingDistribution: asJson(row.rating_distribution),
    isClaimed: row.is_claimed === true,

    // Rich nested payloads
    description: row.description ?? null,
    attributes: asJson(row.attributes),
    // DfS nests hours at row.work_time.work_hours.timetable. We persist
    // the whole work_time object so timezone + current_status flags are
    // preserved alongside the timetable itself.
    hours: asJson(row.work_time),
    placeTopics: asJson(row.place_topics),
    peopleAlsoSearch: asJson(row.people_also_search),
    popularTimes: asJson(row.popular_times),
    localBusinessLinks: asJson(row.local_business_links),

    // Provenance
    checkUrl: row.check_url ?? null,
    firstSeenOnGoogle: parseDfsTimestamp(row.first_seen),
    sourceLastUpdatedAt: parseDfsTimestamp(row.last_updated_time),
    sourceRawJson: asJsonStrict(row),
  };
}

/** Parse DfS timestamps · format is "YYYY-MM-DD HH:MM:SS +00:00". */
function parseDfsTimestamp(raw: string | null | undefined): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Narrow an unknown payload to the Prisma Json input shape (or undefined,
 *  which Prisma treats as "skip the column" — DB defaults to NULL since
 *  these columns are nullable). */
function asJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === null || v === undefined) return undefined;
  return v as Prisma.InputJsonValue;
}

/** Coerce a row (which Zod passthrough may have decorated) to Prisma Json. */
function asJsonStrict(v: unknown): Prisma.InputJsonValue {
  if (v === null || v === undefined) return {};
  return v as Prisma.InputJsonValue;
}

/**
 * Slugify a business name into a URL-safe segment. Lowercase, ASCII,
 * stripped of diacritics, hyphenated. Capped at 80 chars so the unique
 * suffix can fit alongside.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Mint a unique slug for the given name. Probes `${base}`, `${base}-2`,
 * … `${base}-10` then falls back to a 6-char random tail. The fallback
 * guarantees the call never blocks on a sufficiently busy collision.
 */
export async function mintUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "business";
  for (let i = 0; i < 10; i += 1) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await prisma.business.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!taken) return slug;
  }
  const tail = Math.random().toString(36).slice(2, 8);
  return `${base}-${tail}`;
}

/**
 * Batch dedup pre-filter · ONE query per page instead of one per row.
 *
 * `persistBusinessRow` checks (CID, placeId) individually — fine at
 * limit≤200, but a 1000-row page of mostly-known businesses would burn
 * 1000 sequential round-trips. The runner calls this first and only
 * routes genuinely-new rows into `persistBusinessRow` (which keeps its
 * own re-check as the race guard).
 */
export async function findExistingBusinessKeys(rows: {
  cids: string[];
  placeIds: string[];
}): Promise<{ cids: Set<string>; placeIds: Set<string> }> {
  if (rows.cids.length === 0 && rows.placeIds.length === 0) {
    return { cids: new Set(), placeIds: new Set() };
  }
  const existing = await prisma.business.findMany({
    where: {
      OR: [
        rows.cids.length
          ? { googleCid: { in: rows.cids } }
          : { id: "__never__" },
        rows.placeIds.length
          ? { googlePlaceId: { in: rows.placeIds } }
          : { id: "__never__" },
      ],
    },
    select: { googleCid: true, googlePlaceId: true },
  });
  return {
    cids: new Set(
      existing.map((e) => e.googleCid).filter((v): v is string => !!v),
    ),
    placeIds: new Set(
      existing.map((e) => e.googlePlaceId).filter((v): v is string => !!v),
    ),
  };
}

/**
 * Outcome of attempting to insert one row. Lets the caller tally
 * new vs duplicate vs error counts for the `DiscoveryRun` audit row.
 */
export type PersistOutcome = "created" | "duplicate" | "error";

/**
 * Insert one DataForSEO row into `Business`, dedupping by CID then
 * placeId. Catches the race where another concurrent run snuck in
 * the same CID (re-check + treat as duplicate, no throw).
 */
export async function persistBusinessRow(
  shape: PersistShape,
  source: BusinessSourceValue,
): Promise<PersistOutcome> {
  const existing = await prisma.business.findFirst({
    where: {
      OR: [
        shape.googleCid ? { googleCid: shape.googleCid } : { id: "__never__" },
        shape.googlePlaceId
          ? { googlePlaceId: shape.googlePlaceId }
          : { id: "__never__" },
      ],
    },
    select: { id: true, cellKey: true },
  });
  if (existing) {
    // Re-stamp cell membership for a row discovered before it had a cell (a
    // legacy/admin-seeded business with a null cellKey would otherwise be
    // silently absent from the demand raw-list union). Don't move a business
    // that already owns a cell (respect its existing primary cell). Always
    // refresh the open/closed status (it's cheap + current).
    const cellData: Record<string, unknown> = { lastRefreshedAt: new Date() };
    if (shape.openStatus !== undefined) cellData.openStatus = shape.openStatus;
    if (!existing.cellKey && shape.cellKey) {
      cellData.cellKey = shape.cellKey;
      if (shape.metroSlug !== undefined) cellData.metroSlug = shape.metroSlug;
      if (shape.anchorDistanceKm !== undefined)
        cellData.anchorDistanceKm = shape.anchorDistanceKm;
      if (shape.crossMetroDupe !== undefined)
        cellData.crossMetroDupe = shape.crossMetroDupe;
    }
    await prisma.business
      .update({
        where: { id: existing.id },
        data: cellData as Prisma.BusinessUpdateInput,
      })
      .catch(() => {
        // A re-stamp hiccup must never fail the discovery batch.
      });
    return "duplicate";
  }

  const slug = await mintUniqueSlug(shape.name);
  try {
    await prisma.business.create({
      data: {
        ...shape,
        slug,
        // Prefer DfS's first_seen when available; fall back to today
        // only if DfS didn't supply it (rare · defensive).
        firstSeenOnGoogle: shape.firstSeenOnGoogle ?? new Date(),
        isActive: true,
        source,
      },
    });
    return "created";
  } catch {
    // Race: another inserter beat us on the same CID/slug — treat as dup
    const reRead = await prisma.business.findFirst({
      where: shape.googleCid ? { googleCid: shape.googleCid } : { slug },
      select: { id: true },
    });
    return reRead ? "duplicate" : "error";
  }
}
