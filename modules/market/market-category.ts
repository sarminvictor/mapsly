/**
 * Scoring v2 · market-category resolution
 *
 * Aligns scoring "cells" with the Discovery markets (`/admin/discovery`). A
 * discovered business stores only its raw Google category (e.g. "Laser hair
 * removal service"), so grouping cells by that splits one market into many.
 * Discovery defines markets as (BusinessCategory × city × country) via
 * `TrackedLocation` — so we map each business back to the tracked market it
 * belongs to, using the DfS category slugs the business carries (`categoryIds`).
 *
 * Used by both cell-aggregate and pillar-scoring so the cell key matches.
 */

import prisma from "@/lib/prisma";
import { boundingBoxForCell } from "@/modules/business-discovery/cell-membership";

export interface TrackedMarket {
  /** Human label, e.g. "Medical Spa" (BusinessCategory.label). */
  label: string;
  /** DfS slug, e.g. "medical_spa" (BusinessCategory.dataforseoId). */
  dataforseoId: string;
  city: string;
  country: string;
  /** Discovery geo — the radius is the market, not the administrative city. */
  lat: number;
  lng: number;
  radiusKm: number;
}

/** Load every active Discovery market (one per tracked category × city × country). */
export async function loadTrackedMarkets(): Promise<TrackedMarket[]> {
  const locs = await prisma.trackedLocation.findMany({
    where: { isActive: true },
    select: {
      city: true,
      country: true,
      lat: true,
      lng: true,
      radiusKm: true,
      category: { select: { label: true, dataforseoId: true } },
    },
  });
  return locs.map((l) => ({
    label: l.category.label,
    dataforseoId: l.category.dataforseoId,
    city: l.city,
    country: l.country,
    lat: l.lat,
    lng: l.lng,
    radiusKm: l.radiusKm,
  }));
}

/** The cell a business belongs to · `(category, city, country)`. */
export interface ResolvedCell {
  category: string;
  city: string;
  country: string;
}

/** True when (lat,lng) sits inside the market's radius box — the SAME geometry
 *  discovery + qualify use for membership (box, not haversine; corner
 *  over-inclusion ~1.4× radius is accepted). Shared via `boundingBoxForCell`
 *  so all consumers stay in lock-step. */
function withinMarketBox(lat: number, lng: number, m: TrackedMarket): boolean {
  const box = boundingBoxForCell({
    lat: m.lat,
    lng: m.lng,
    radiusKm: m.radiusKm,
  });
  return (
    lat >= box.latMin &&
    lat <= box.latMax &&
    lng >= box.lngMin &&
    lng <= box.lngMax
  );
}

/**
 * Resolve a business to its scoring CELL by GEO containment — a discovery
 * market is its whole radius, NOT its administrative city. Every business
 * inside a tracked market's radius shares that market's cell
 * `(label, market-city, country)`, regardless of the business's own Google
 * city/category — so the radius is ONE cell (e.g. Coral Gables / Miami Beach
 * spas inside Miami's 10 km radius all land in `Medical Spa · Miami · US`).
 *
 * Fallbacks: a business with coordinates inside MULTIPLE overlapping markets
 * prefers one whose DfS slug it carries, else the nearest center. A business
 * with no coordinates, or outside every market radius, falls back to the
 * legacy `(resolved-or-raw category, raw city, country)`.
 */
export function resolveMarketCell(
  biz: {
    category: string;
    categoryIds: string[];
    city: string | null;
    country: string | null;
    lat: number | null;
    lng: number | null;
  },
  markets: readonly TrackedMarket[],
): ResolvedCell {
  if (biz.lat != null && biz.lng != null) {
    const inside = markets.filter((m) =>
      withinMarketBox(biz.lat!, biz.lng!, m),
    );
    if (inside.length > 0) {
      const bySlug = inside.find((m) =>
        biz.categoryIds.includes(m.dataforseoId),
      );
      const m =
        bySlug ??
        (inside.length === 1
          ? inside[0]!
          : nearestMarket(biz.lat, biz.lng, inside));
      return { category: m.label, city: m.city, country: m.country };
    }
  }
  // No coords or outside every radius → legacy raw cell.
  return {
    category: resolveMarketCategory(biz, markets),
    city: biz.city ?? "",
    country: biz.country ?? "",
  };
}

/** Nearest market center (squared degree distance · fine for tie-breaks). */
function nearestMarket(
  lat: number,
  lng: number,
  markets: readonly TrackedMarket[],
): TrackedMarket {
  let best = markets[0]!;
  let bestD = Infinity;
  for (const m of markets) {
    const d = (lat - m.lat) ** 2 + (lng - m.lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/**
 * Resolve a business to its Discovery MARKET category label, so cells align
 * with `/admin/discovery`. Prefers a tracked market in the same geo whose DfS
 * slug the business actually carries; falls back to the only market in that geo;
 * finally falls back to the raw category (business outside any tracked market).
 */
export function resolveMarketCategory(
  biz: {
    category: string;
    categoryIds: string[];
    city: string | null;
    country: string | null;
  },
  markets: readonly TrackedMarket[],
): string {
  if (!biz.city || !biz.country) return biz.category;
  const inGeo = markets.filter(
    (m) => m.city === biz.city && m.country === biz.country,
  );
  if (inGeo.length === 0) return biz.category;
  for (const m of inGeo) {
    if (biz.categoryIds.includes(m.dataforseoId)) return m.label;
  }
  // Exactly one tracked market in this geo → its discovered businesses belong to it.
  if (inGeo.length === 1) return inGeo[0]!.label;
  return biz.category;
}
