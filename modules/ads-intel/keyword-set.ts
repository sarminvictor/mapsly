// modules/ads-intel/keyword-set.ts · the service-keyword set for the /ads page.
//
// Pure · no IO. Shared by the collector (what ad-cost data to fetch) and the
// query layer (what to read back) so they never drift. Returns BASE (non-city)
// service terms at the country location — city-suffixed terms have negligible
// volume, whereas "botox" nationally is the meaningful CPC/competition signal.

import { buildKeywordSetForBusiness } from "@/modules/local-intent/build-keyword-set";

/** DataForSEO numeric location code for a business country. */
export function locationCodeForCountry(
  country: string | null | undefined,
): number {
  switch ((country ?? "US").toUpperCase()) {
    case "CA":
      return 2124;
    case "GB":
    case "UK":
      return 2826;
    case "AU":
      return 2036;
    default:
      return 2840; // US
  }
}

export interface AdsKeywordSetInput {
  category: string | null;
  city: string | null;
  /** Optional explicit service names (from BusinessService) — preferred. */
  serviceNames?: readonly string[];
}

const MAX_KEYWORDS = 40;

function normalizeTerm(raw: string | null | undefined, city: string): string {
  if (!raw) return "";
  let s = raw.toLowerCase().trim();
  if (city) s = s.split(city).join(" ");
  // Keep letters/digits/space/&/- only; collapse whitespace.
  s = s
    .replace(/[^a-z0-9 &-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/**
 * The service keywords whose ad economics (CPC / competition / bids) the SMB
 * /ads page surfaces. Order: explicit services → industry-template base terms →
 * category fallback. Deduped, cleaned, capped at {@link MAX_KEYWORDS}.
 */
export function adsServiceKeywords(input: AdsKeywordSetInput): string[] {
  const city = (input.city ?? "").toLowerCase().trim();
  const set = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const s = normalizeTerm(raw, city);
    if (s.length >= 2) set.add(s);
  };

  for (const n of input.serviceNames ?? []) add(n);

  // Industry templates are city-suffixed ("botox calgary"); strip the city to
  // recover the base term ("botox") for national volume/CPC.
  const { keywords } = buildKeywordSetForBusiness({
    category: input.category,
    city: input.city,
  });
  for (const kw of keywords) add(kw.keyword);

  if (set.size === 0) {
    add(input.category);
  }

  return Array.from(set).slice(0, MAX_KEYWORDS);
}
