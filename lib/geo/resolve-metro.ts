// lib/geo/resolve-metro.ts · alias-collapse metro resolver (Phase 1).
//
// Turns a typed city/neighborhood ("Miami Beach", "Brickell", "Coral Gables")
// into its parent metro ("Miami, FL") so the user picks/sees ONE location, and
// stamps every discovered business to its owning metro by nearest anchor.

import { US_METROS, radiusKmForMetro, type UsMetro } from "./us-metros";

/** Normalize a free-text place query for matching. */
export function normalizePlace(q: string): string {
  return q
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Build a normalized lookup index once at module load.
const INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const metro of US_METROS) {
    const cityOnly = metro.name.split(",")[0] ?? metro.name;
    for (const key of [
      cityOnly,
      metro.name,
      metro.slug.replace(/-/g, " "),
      ...metro.aliases,
    ]) {
      const norm = normalizePlace(key);
      if (norm && !m.has(norm)) m.set(norm, metro.slug);
    }
  }
  return m;
})();

const BY_SLUG: Map<string, UsMetro> = new Map(
  US_METROS.map((m) => [m.slug, m]),
);

export function metroBySlug(slug: string): UsMetro | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * Resolve a typed place to its parent metro. Tries an exact normalized match
 * against metro names, slugs, and aliases; then a trailing-state-stripped
 * retry ("austin texas" → "austin"). Returns null if no metro matches.
 */
export function resolveMetro(query: string): UsMetro | null {
  const norm = normalizePlace(query);
  if (!norm) return null;

  const direct = INDEX.get(norm);
  if (direct) return BY_SLUG.get(direct) ?? null;

  // Retry without a trailing state token ("miami fl", "austin texas").
  const tokens = norm.split(" ");
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (US_STATE_TOKENS.has(last)) {
      const stripped = tokens.slice(0, -1).join(" ");
      const hit = INDEX.get(stripped);
      if (hit) return BY_SLUG.get(hit) ?? null;
    }
  }
  return null;
}

/** Great-circle distance between two lat/lng points in km. */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface NearestMetroResult {
  metro: UsMetro;
  distanceKm: number;
  /** All metros whose radius circle contains the point (overlap zone). */
  containingSlugs: string[];
}

/**
 * Stamp a lat/lng to its OWNING metro = the nearest anchor whose radius circle
 * contains the point. `containingSlugs.length > 1` ⇒ the point sits in an
 * overlap zone (set Business.crossMetroDupe) but is owned by the nearest.
 * Returns null if the point is outside every metro radius.
 */
export function nearestMetro(
  lat: number,
  lng: number,
): NearestMetroResult | null {
  let best: { metro: UsMetro; distanceKm: number } | null = null;
  const containing: string[] = [];
  for (const metro of US_METROS) {
    const d = haversineKm(lat, lng, metro.lat, metro.lng);
    if (d <= radiusKmForMetro(metro)) {
      containing.push(metro.slug);
      if (!best || d < best.distanceKm) best = { metro, distanceKm: d };
    }
  }
  if (!best) return null;
  return {
    metro: best.metro,
    distanceKm: Math.round(best.distanceKm * 100) / 100,
    containingSlugs: containing,
  };
}

const US_STATE_TOKENS = new Set([
  "al",
  "ak",
  "az",
  "ar",
  "ca",
  "co",
  "ct",
  "de",
  "fl",
  "ga",
  "hi",
  "id",
  "il",
  "in",
  "ia",
  "ks",
  "ky",
  "la",
  "me",
  "md",
  "ma",
  "mi",
  "mn",
  "ms",
  "mo",
  "mt",
  "ne",
  "nv",
  "nh",
  "nj",
  "nm",
  "ny",
  "nc",
  "nd",
  "oh",
  "ok",
  "or",
  "pa",
  "ri",
  "sc",
  "sd",
  "tn",
  "tx",
  "ut",
  "vt",
  "va",
  "wa",
  "wv",
  "wi",
  "wy",
  "dc",
  "texas",
  "california",
  "florida",
  "newyork",
]);
