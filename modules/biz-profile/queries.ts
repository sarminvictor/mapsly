/**
 * Public business profile · server queries.
 *
 * Two query surfaces:
 *
 * 1. `getBusinessBySlug(slug)` — fetches one business + denormalises its
 *    latest `BusinessSnapshot` into a flat `BizProfileData`. Returns the
 *    EMPTY shape (id === "") when no business matches the slug, so the
 *    page handler can dispatch `notFound()` uniformly without distinguishing
 *    "missing" from "build-time prerender stub" (per
 *    `.claude/rules/cache-components.md` Pattern 1).
 *
 * 2. `listBizSitemapEntries(limit)` — bounded enumeration for
 *    `app/sitemap.ts`. Returns slugs of active businesses + a stable
 *    `lastModified` (latest snapshot date or business `updatedAt`).
 *    Bounded by `limit` to stay under Google's 50,000-URL-per-sitemap cap
 *    (currently 500 active businesses; cap unlikely to bite at launch).
 *
 * Caching strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` directive + `cacheLife('hours')` (snapshots refresh
 *     weekly via the C.9 cron, but business identity may update daily via
 *     C.8 — hourly cache is the most generous profile consistent with that).
 *   - `cacheTag('biz-profile-{slug}')` — granular so a single biz refresh
 *     can revalidate one page (called by `app/api/cron/weekly/snapshot-write`
 *     once C.9 ships its revalidate hook · TODO captured in PLAN.md).
 *   - `cacheTag('biz-sitemap')` for the enumeration, revalidated on any
 *     business add/remove.
 *
 * Per INC-27, every `'use cache'` Prisma query MUST short-circuit when
 * `NEXT_PHASE === 'phase-production-build'` because Vercel's build worker
 * cannot open Neon WebSockets. The short-circuit returns the EMPTY shape;
 * runtime first-request re-runs the function and gets real data.
 *
 * Per `.claude/rules/performance.md`, `select`s are explicit — never an
 * unbounded `findMany`/`findFirst`.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_BIZ_PROFILE,
  type BizProfileData,
  type BizSitemapEntry,
} from "./types";

/**
 * Fetch one business by slug + denormalise its latest snapshot.
 *
 * Returns `EMPTY_BIZ_PROFILE` (id === "") when:
 *   - slug doesn't match any active business
 *   - we're in Vercel build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrades to "looks like 404" rather than 500 crash)
 *
 * Callers MUST check `data.id === ""` and dispatch `notFound()` accordingly.
 */
export async function getBusinessBySlug(slug: string): Promise<BizProfileData> {
  "use cache";
  cacheLife("hours");
  cacheTag(`biz-profile-${slug}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_BIZ_PROFILE;
  }

  // Defensive empty-slug guard — `next/navigation` `notFound()` is preferred
  // but this helper may be called by `generateMetadata` before route params
  // are validated, so return EMPTY on garbage input.
  if (!slug || typeof slug !== "string") {
    return EMPTY_BIZ_PROFILE;
  }

  try {
    const business = await prisma.business.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        address: true,
        city: true,
        province: true,
        country: true,
        postalCode: true,
        lat: true,
        lng: true,
        phone: true,
        website: true,
        rating: true,
        reviewCount: true,
        photosCount: true,
        isClaimed: true,
        isActive: true,
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
          select: {
            mapslyScore: true,
            msiRank: true,
            msiTotal: true,
            replyRate: true,
            velocityLast30d: true,
            snapshotDate: true,
          },
        },
      },
    });

    if (!business || !business.isActive) {
      return EMPTY_BIZ_PROFILE;
    }

    const snap = business.snapshots[0] ?? null;

    return {
      id: business.id,
      slug: business.slug,
      name: business.name,
      category: business.category,
      address: business.address,
      city: business.city,
      province: business.province,
      country: business.country,
      postalCode: business.postalCode,
      lat: business.lat,
      lng: business.lng,
      phone: business.phone,
      website: business.website,
      rating: business.rating,
      reviewCount: business.reviewCount,
      photosCount: business.photosCount,
      isClaimed: business.isClaimed,
      mapslyScore: snap?.mapslyScore ?? null,
      msiRank: snap?.msiRank ?? null,
      msiTotal: snap?.msiTotal ?? null,
      replyRate: snap?.replyRate ?? null,
      velocityLast30d: snap?.velocityLast30d ?? null,
      lastSnapshotAt: snap?.snapshotDate ?? null,
    };
  } catch {
    // Degrades to "missing" rather than 500 — see file header.
    return EMPTY_BIZ_PROFILE;
  }
}

/**
 * Enumerate active business slugs for the sitemap.
 *
 * Bounded by `limit` (default 5000) to stay well under Google's 50k cap.
 * When the index grows past 50k, this should split into sitemap-index files
 * per `app/sitemap.ts` header note.
 *
 * `lastModified` is the latest snapshot date when present, else the
 * business's `updatedAt`. Both are stable absolute dates so PPR prerender
 * is happy (no `new Date()`).
 */
export async function listBizSitemapEntries(
  limit = 5000,
): Promise<BizSitemapEntry[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("biz-sitemap");

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return [];
  }

  try {
    const rows = await prisma.business.findMany({
      where: { isActive: true },
      take: limit,
      orderBy: { slug: "asc" },
      select: {
        slug: true,
        updatedAt: true,
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
          select: { snapshotDate: true },
        },
      },
    });

    return rows.map((r) => ({
      slug: r.slug,
      lastModified: r.snapshots[0]?.snapshotDate ?? r.updatedAt,
    }));
  } catch {
    return [];
  }
}
