// modules/cell-intel/cell-context.ts · resolve a cellKey into collector inputs.
//
// A Cell = 1 metro × 1 category (canonical key "categorySlug|metroSlug|country",
// see lib/cell.ts). The cell-intel collectors take a cellKey and need:
//   - the parsed category / metro / country,
//   - the metro's display label + anchor coords (for SERP geo + Meta city term),
//   - the businesses indexed in the cell (for ad attribution + SERP reverse-map),
//   - the DataForSEO numeric location code.
//
// This module centralizes that resolution so the three collectors never drift.
// No external API calls — DB reads + the frozen metro gazetteer only.

import prisma from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import { metroBySlug } from "@/lib/geo/resolve-metro";
import { radiusKmForMetro, type UsMetro } from "@/lib/geo/us-metros";
import { locationCodeForCountry } from "@/modules/ads-intel/keyword-set";

export interface CellBusiness {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  website: string | null;
  fbPageId: string | null;
}

export interface CellContext {
  cellKey: string;
  categorySlug: string;
  metroSlug: string;
  country: string;
  /** Metro gazetteer entry (anchor coords, label, radius tier). */
  metro: UsMetro;
  /** Human city label (e.g. "Miami") derived from the metro name. */
  cityLabel: string;
  /** DataForSEO numeric location code for the cell's country. */
  locationCode: number;
  /** "lat,lng,radiusKm" string for serpLocalPack geo scoping. */
  locationCoordinate: string;
  /** Businesses indexed in this cell (for attribution + reverse-map). */
  businesses: CellBusiness[];
}

const BIZ_SELECT = {
  id: true,
  name: true,
  slug: true,
  domain: true,
  website: true,
  fbPageId: true,
} as const;

/** Max businesses loaded per cell for attribution (bounds memory + DB cost). */
const MAX_CELL_BUSINESSES = 500;

/**
 * Resolve a cellKey into the collector context. Returns null if the cellKey is
 * malformed or the metro slug is unknown (so callers can early-return a
 * skipped result instead of throwing inside a paid CronRun).
 */
export async function resolveCellContext(
  cellKey: string,
): Promise<CellContext | null> {
  const parsed = parseCellKey(cellKey);
  if (!parsed) return null;

  const metro = metroBySlug(parsed.metroSlug);
  if (!metro) return null;

  const cityLabel = (metro.name.split(",")[0] ?? metro.name).trim();
  const locationCode = locationCodeForCountry(parsed.country);
  const radiusKm = radiusKmForMetro(metro);
  const locationCoordinate = `${metro.lat},${metro.lng},${radiusKm}`;

  const businesses = await prisma.business.findMany({
    where: { cellKey, isActive: true },
    take: MAX_CELL_BUSINESSES,
    select: BIZ_SELECT,
  });

  return {
    cellKey,
    categorySlug: parsed.categorySlug,
    metroSlug: parsed.metroSlug,
    country: parsed.country,
    metro,
    cityLabel,
    locationCode,
    locationCoordinate,
    businesses,
  };
}

/** Host (no www) from a stored domain/website. Mirrors ads-intel/collect. */
export function hostOf(
  biz: Pick<CellBusiness, "domain" | "website">,
): string | null {
  const raw = biz.domain ?? biz.website;
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return (
      raw
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0] || null
    );
  }
}

/**
 * The cell's representative keyword(s) for SERP scans. The category slug is
 * de-slugged ("medical_spa" → "medical spa") and suffixed with the city to form
 * the local-intent query ("medical spa miami"). Returns a small, deduped set.
 */
export function representativeKeywords(ctx: CellContext): string[] {
  const base = ctx.categorySlug.replace(/[_-]+/g, " ").trim();
  const city = ctx.cityLabel.toLowerCase();
  const set = new Set<string>();
  if (base) {
    set.add(city ? `${base} ${city}`.trim() : base);
    set.add(base); // national fallback term
  }
  return [...set].filter((k) => k.length >= 2);
}
