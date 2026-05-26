/**
 * Location geocoding · resolves city + country → lat/lng coordinates.
 *
 * Uses OpenStreetMap Nominatim, the public free geocoder. No API key
 * required. Rate-limited to 1 request per second per
 * https://operations.osmfoundation.org/policies/nominatim/ — admin
 * operations are low-frequency so this is fine. We MUST set a
 * descriptive User-Agent identifying Mapsly so they can contact us
 * if our use becomes problematic.
 *
 * Returned coordinates are the centroid of the matched feature
 * (city/town/borough). Admin can override the coords manually if the
 * geocoder picks a sub-centroid (e.g. a neighborhood instead of the
 * whole city).
 *
 * Errors are returned as `null` — the caller treats a null geocode as
 * a validation failure and surfaces the message to the admin.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** OpenStreetMap's normalised name — useful for display next to admin input. */
  displayName: string;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "Mapsly Admin Discovery (sarminvictor@gmail.com) +https://mapsly.ai";

/**
 * Geocode a (city, province, country) triple. Province is optional but
 * dramatically improves accuracy for ambiguous city names (Portland
 * could be OR or ME; "Portland, OR, US" disambiguates).
 *
 * Returns null on network error, no match, or a malformed payload.
 */
export async function geocodeLocation(input: {
  city: string;
  province?: string | null;
  country: string;
}): Promise<GeocodeResult | null> {
  const { city, province, country } = input;
  if (!city || !country) return null;

  const params = new URLSearchParams({
    city,
    country,
    format: "jsonv2",
    limit: "1",
    addressdetails: "0",
  });
  if (province) params.set("state", province);

  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      // We don't want this in any of Next's caches — admin asks fresh
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
    }>;
    const first = payload?.[0];
    if (!first?.lat || !first?.lon) return null;
    const lat = Number.parseFloat(first.lat);
    const lng = Number.parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      displayName: first.display_name ?? `${city}, ${country}`,
    };
  } catch {
    return null;
  }
}
