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

export interface TrackedMarket {
  /** Human label, e.g. "Medical Spa" (BusinessCategory.label). */
  label: string;
  /** DfS slug, e.g. "medical_spa" (BusinessCategory.dataforseoId). */
  dataforseoId: string;
  city: string;
  country: string;
}

/** Load every active Discovery market (one per tracked category × city × country). */
export async function loadTrackedMarkets(): Promise<TrackedMarket[]> {
  const locs = await prisma.trackedLocation.findMany({
    where: { isActive: true },
    select: {
      city: true,
      country: true,
      category: { select: { label: true, dataforseoId: true } },
    },
  });
  return locs.map((l) => ({
    label: l.category.label,
    dataforseoId: l.category.dataforseoId,
    city: l.city,
    country: l.country,
  }));
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
