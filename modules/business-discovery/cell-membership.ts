/**
 * Cell membership · the ONE definition of "which Business rows belong
 * to a TrackedLocation".
 *
 * History: membership used to be `(categoryIds has slug, city, country)`
 * — an exact city-name match. Discovery, however, pulls by RADIUS, and
 * Google labels each row with its real administrative city. The first
 * Miami run (2026-06-11) created 100 businesses of which 37 were in
 * Coral Gables / Miami Beach / Key Biscayne — inside the 10km radius,
 * permanently invisible to Qualify. Membership now matches the same
 * geometry discovery searched: a lat/lng bounding box around the cell
 * center sized to its radius.
 *
 * Consumers (keep in lock-step — all three MUST share this helper):
 *   - `runQualifyCell` server action (app/(admin)/admin/discovery/actions.ts)
 *   - `qualifyCell()` (modules/business-qualification/qualify.ts)
 *   - `recomputeCellAggregates()` (same file — groupBy, which is why
 *     membership is a box, not a haversine circle: it must be
 *     expressible as a plain Prisma `where` for BOTH findMany and
 *     groupBy. Corner over-inclusion (~1.4× radius at the diagonal) is
 *     accepted — a spa 13km out in a 10km cell is still a local lead.)
 *
 * Rows with NULL coordinates (~rare: DfS omits lat/lng on some mobile-
 * service listings) fall back to the old exact city+country match so
 * they don't drop out of the cell entirely.
 */

import type { Prisma } from "@/lib/prisma";

export interface CellGeometry {
  /** DfS category slug — matched against Business.categoryIds. */
  dataforseoCategoryId: string;
  lat: number;
  lng: number;
  radiusKm: number;
  /** Fallback identity for rows without coordinates. */
  city: string;
  country: string;
}

export interface BoundingBox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

const KM_PER_DEGREE_LAT = 111.32;

/** Degree box that contains the cell's radius circle. Longitude width
 *  scales with latitude (degrees shrink toward the poles). Clamped so
 *  polar/antimeridian edge cases can't produce inverted boxes — our
 *  cells are US/CA cities, but the math shouldn't trust that. */
export function boundingBoxForCell(cell: {
  lat: number;
  lng: number;
  radiusKm: number;
}): BoundingBox {
  const latDelta = cell.radiusKm / KM_PER_DEGREE_LAT;
  const cosLat = Math.max(0.01, Math.cos((cell.lat * Math.PI) / 180));
  const lngDelta = cell.radiusKm / (KM_PER_DEGREE_LAT * cosLat);
  return {
    latMin: Math.max(-90, cell.lat - latDelta),
    latMax: Math.min(90, cell.lat + latDelta),
    lngMin: Math.max(-180, cell.lng - lngDelta),
    lngMax: Math.min(180, cell.lng + lngDelta),
  };
}

/** Prisma `where` selecting the cell's member businesses. Works for
 *  findMany AND groupBy (no post-filtering required). */
export function cellMembershipWhere(
  cell: CellGeometry,
): Prisma.BusinessWhereInput {
  const box = boundingBoxForCell(cell);
  return {
    categoryIds: { has: cell.dataforseoCategoryId },
    OR: [
      {
        lat: { gte: box.latMin, lte: box.latMax },
        lng: { gte: box.lngMin, lte: box.lngMax },
      },
      // Coordinate-less rows: legacy exact-city fallback.
      { lat: null, city: cell.city, country: cell.country },
    ],
  };
}
