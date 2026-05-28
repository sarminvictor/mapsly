/**
 * Compose the canonical local-intent keyword set for ONE business.
 *
 * High-level pipeline (used by `discover-local-intent.ts` + by
 * `aggregate-cell-maps.ts` for cell-level keyword pool derivation):
 *
 *   1. Map Business.category → IndustryKey (skip if unknown)
 *   2. Build the city-filled keyword list from templates
 *   3. (S.7 hook) Layer in `services-detect` flags · for now we
 *      enable every service template so coverage is generous
 *
 * Pure function · server-component-safe · no DB / no API. The caller
 * supplies the business shape it has on hand.
 */

import type { ExpandedKeyword, IndustryKey } from "./templates";
import { expandTemplatesForBusiness } from "./templates";
import { industryForCategory } from "./category-to-industry";

export interface BuildKeywordSetInput {
  /** Business.category as stored in the DB. */
  category: string | null;
  /** Business.city · MUST be a real city name; "" or null skips. */
  city: string | null;
  /**
   * `services-detect` output · per-flag boolean map. Pass `null` to
   * enable every service template (S.6 default until S.7 lands).
   */
  serviceFlags?: Readonly<Record<string, boolean>> | null;
}

export interface BuildKeywordSetResult {
  /** null when the business has no city or unknown category · the
   *  caller should skip this business and emit a diagnostic. */
  industry: IndustryKey | null;
  /** The expanded keyword set · empty for skipped businesses. */
  keywords: ExpandedKeyword[];
}

export function buildKeywordSetForBusiness(
  input: BuildKeywordSetInput,
): BuildKeywordSetResult {
  if (!input.city || input.city.trim() === "") {
    return { industry: null, keywords: [] };
  }
  const industry = industryForCategory(input.category);
  if (!industry) {
    return { industry: null, keywords: [] };
  }
  const keywords = expandTemplatesForBusiness({
    industry,
    city: input.city,
    serviceFlags: input.serviceFlags ?? null,
  });
  return { industry, keywords };
}

/**
 * Compose the keyword pool for a whole cell · union of every cell
 * business's local-intent set. Used by `aggregate-cell-maps.ts` so
 * Maps queries cover everyone in the cell with one shared list. Dedup
 * on the keyword string (origin from whichever business added it
 * first; UI uses per-row origin, not cell origin, for the badge).
 */
export function buildKeywordSetForCell(
  businesses: ReadonlyArray<BuildKeywordSetInput>,
): ExpandedKeyword[] {
  const seen = new Map<string, ExpandedKeyword>();
  for (const b of businesses) {
    const r = buildKeywordSetForBusiness(b);
    for (const kw of r.keywords) {
      if (!seen.has(kw.keyword)) seen.set(kw.keyword, kw);
    }
  }
  return Array.from(seen.values());
}
