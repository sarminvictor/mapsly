// lib/geo/us-metros.ts · frozen US metro gazetteer (Phase 1).
//
// The demand model consolidates a metropolitan area into ONE user-facing
// "location" (Miami = one entry, not Miami Beach / Brickell / Hialeah). Each
// metro has a centroid anchor, a fixed radius tier, and an alias list of the
// sub-cities/neighborhoods that collapse into it. Businesses are grouped to a
// metro by radius around the anchor.
//
// This is a curated representative set (~36 of the top US metros, >70% of US
// urban business density, Sun-Belt-weighted per the seed-metros plan). It is
// regenerated/extended to the full top-150 by scripts/build-metro-gazetteer.ts
// (Census CBSA + SimpleMaps) — additive, zero migration. Radius is DERIVED
// from the tier and is display-only (never user-editable).

import { GENERATED_CITIES } from "./places.generated";

export type RadiusTier = "MEGA" | "LARGE" | "MID" | "SMALL" | "MICRO";

/** Fixed radius (km) per tier. Headline metro = LARGE = 30km. Mega capped at
 *  40km so a metro never bleeds into an adjacent one (LA → Riverside). */
export const RADIUS_KM_BY_TIER: Record<RadiusTier, number> = {
  MEGA: 40,
  LARGE: 30,
  MID: 24,
  SMALL: 18,
  MICRO: 12,
};

export interface UsMetro {
  slug: string;
  name: string; // user-facing label, e.g. "Miami, FL"
  state: string; // USPS code
  lat: number;
  lng: number;
  radiusTier: RadiusTier;
  /** ISO-2 country. Optional — absent means "US" (the curated majors predate
   *  the US+CA expansion). The generated cities always set it explicitly. */
  country?: "US" | "CA" | "PL";
  /** Lowercased sub-cities/neighborhoods that collapse into this metro. */
  aliases: string[];
}

export const CURATED_METROS: readonly UsMetro[] = [
  {
    slug: "new-york",
    name: "New York, NY",
    state: "NY",
    lat: 40.7128,
    lng: -74.006,
    radiusTier: "MEGA",
    aliases: [
      "manhattan",
      "brooklyn",
      "queens",
      "the bronx",
      "bronx",
      "jersey city",
      "hoboken",
      "newark",
    ],
  },
  {
    slug: "los-angeles",
    name: "Los Angeles, CA",
    state: "CA",
    lat: 34.0522,
    lng: -118.2437,
    radiusTier: "MEGA",
    aliases: [
      "hollywood",
      "santa monica",
      "long beach",
      "pasadena",
      "burbank",
      "glendale",
      "culver city",
      "west hollywood",
    ],
  },
  {
    slug: "chicago",
    name: "Chicago, IL",
    state: "IL",
    lat: 41.8781,
    lng: -87.6298,
    radiusTier: "MEGA",
    aliases: ["evanston", "oak park", "naperville", "cicero", "skokie"],
  },
  {
    slug: "houston",
    name: "Houston, TX",
    state: "TX",
    lat: 29.7604,
    lng: -95.3698,
    radiusTier: "LARGE",
    aliases: ["katy", "sugar land", "the woodlands", "pearland", "spring"],
  },
  {
    slug: "phoenix",
    name: "Phoenix, AZ",
    state: "AZ",
    lat: 33.4484,
    lng: -112.074,
    radiusTier: "LARGE",
    aliases: [
      "scottsdale",
      "tempe",
      "mesa",
      "chandler",
      "gilbert",
      "glendale az",
      "peoria",
    ],
  },
  {
    slug: "philadelphia",
    name: "Philadelphia, PA",
    state: "PA",
    lat: 39.9526,
    lng: -75.1652,
    radiusTier: "LARGE",
    aliases: ["king of prussia", "cherry hill", "bensalem", "conshohocken"],
  },
  {
    slug: "san-antonio",
    name: "San Antonio, TX",
    state: "TX",
    lat: 29.4241,
    lng: -98.4936,
    radiusTier: "LARGE",
    aliases: ["alamo heights", "schertz", "new braunfels"],
  },
  {
    slug: "san-diego",
    name: "San Diego, CA",
    state: "CA",
    lat: 32.7157,
    lng: -117.1611,
    radiusTier: "LARGE",
    aliases: ["la jolla", "chula vista", "coronado", "carlsbad", "encinitas"],
  },
  {
    slug: "dallas",
    name: "Dallas, TX",
    state: "TX",
    lat: 32.7767,
    lng: -96.797,
    radiusTier: "LARGE",
    aliases: [
      "plano",
      "irving",
      "arlington tx",
      "frisco",
      "garland",
      "mckinney",
      "richardson",
    ],
  },
  {
    slug: "austin",
    name: "Austin, TX",
    state: "TX",
    lat: 30.2672,
    lng: -97.7431,
    radiusTier: "LARGE",
    aliases: ["round rock", "cedar park", "georgetown", "pflugerville"],
  },
  {
    slug: "miami",
    name: "Miami, FL",
    state: "FL",
    lat: 25.7617,
    lng: -80.1918,
    radiusTier: "LARGE",
    aliases: [
      "miami beach",
      "coral gables",
      "brickell",
      "hialeah",
      "doral",
      "aventura",
      "kendall",
      "north miami",
      "homestead",
      "miami gardens",
      "south beach",
      "wynwood",
      "coconut grove",
    ],
  },
  {
    slug: "fort-lauderdale",
    name: "Fort Lauderdale, FL",
    state: "FL",
    lat: 26.1224,
    lng: -80.1373,
    radiusTier: "MID",
    aliases: [
      "hollywood fl",
      "pompano beach",
      "plantation",
      "davie",
      "sunrise",
      "coral springs",
      "pembroke pines",
    ],
  },
  {
    slug: "tampa",
    name: "Tampa, FL",
    state: "FL",
    lat: 27.9506,
    lng: -82.4572,
    radiusTier: "LARGE",
    aliases: [
      "st petersburg",
      "saint petersburg",
      "clearwater",
      "brandon",
      "wesley chapel",
    ],
  },
  {
    slug: "orlando",
    name: "Orlando, FL",
    state: "FL",
    lat: 28.5383,
    lng: -81.3792,
    radiusTier: "LARGE",
    aliases: [
      "winter park",
      "kissimmee",
      "sanford",
      "lake mary",
      "altamonte springs",
    ],
  },
  {
    slug: "jacksonville",
    name: "Jacksonville, FL",
    state: "FL",
    lat: 30.3322,
    lng: -81.6557,
    radiusTier: "MID",
    aliases: ["orange park", "ponte vedra"],
  },
  {
    slug: "atlanta",
    name: "Atlanta, GA",
    state: "GA",
    lat: 33.749,
    lng: -84.388,
    radiusTier: "LARGE",
    aliases: [
      "marietta",
      "alpharetta",
      "sandy springs",
      "decatur",
      "roswell",
      "smyrna",
    ],
  },
  {
    slug: "charlotte",
    name: "Charlotte, NC",
    state: "NC",
    lat: 35.2271,
    lng: -80.8431,
    radiusTier: "LARGE",
    aliases: ["matthews", "huntersville", "concord nc"],
  },
  {
    slug: "nashville",
    name: "Nashville, TN",
    state: "TN",
    lat: 36.1627,
    lng: -86.7816,
    radiusTier: "LARGE",
    aliases: ["franklin", "brentwood", "murfreesboro"],
  },
  {
    slug: "denver",
    name: "Denver, CO",
    state: "CO",
    lat: 39.7392,
    lng: -104.9903,
    radiusTier: "LARGE",
    aliases: [
      "aurora",
      "boulder",
      "lakewood",
      "littleton",
      "centennial",
      "englewood",
    ],
  },
  {
    slug: "las-vegas",
    name: "Las Vegas, NV",
    state: "NV",
    lat: 36.1699,
    lng: -115.1398,
    radiusTier: "LARGE",
    aliases: ["henderson", "paradise", "summerlin", "north las vegas"],
  },
  {
    slug: "seattle",
    name: "Seattle, WA",
    state: "WA",
    lat: 47.6062,
    lng: -122.3321,
    radiusTier: "LARGE",
    aliases: ["bellevue", "redmond", "kirkland", "tacoma", "renton", "everett"],
  },
  {
    slug: "portland",
    name: "Portland, OR",
    state: "OR",
    lat: 45.5152,
    lng: -122.6784,
    radiusTier: "LARGE",
    aliases: ["beaverton", "gresham", "hillsboro", "tigard", "lake oswego"],
  },
  {
    slug: "san-francisco",
    name: "San Francisco, CA",
    state: "CA",
    lat: 37.7749,
    lng: -122.4194,
    radiusTier: "LARGE",
    aliases: ["oakland", "berkeley", "daly city", "south san francisco"],
  },
  {
    slug: "san-jose",
    name: "San Jose, CA",
    state: "CA",
    lat: 37.3382,
    lng: -121.8863,
    radiusTier: "LARGE",
    aliases: [
      "santa clara",
      "sunnyvale",
      "mountain view",
      "cupertino",
      "palo alto",
      "milpitas",
    ],
  },
  {
    slug: "sacramento",
    name: "Sacramento, CA",
    state: "CA",
    lat: 38.5816,
    lng: -121.4944,
    radiusTier: "MID",
    aliases: ["roseville", "folsom", "elk grove"],
  },
  {
    slug: "boston",
    name: "Boston, MA",
    state: "MA",
    lat: 42.3601,
    lng: -71.0589,
    radiusTier: "LARGE",
    aliases: ["cambridge", "somerville", "brookline", "quincy", "newton"],
  },
  {
    slug: "washington",
    name: "Washington, DC",
    state: "DC",
    lat: 38.9072,
    lng: -77.0369,
    radiusTier: "LARGE",
    aliases: [
      "arlington va",
      "alexandria",
      "bethesda",
      "silver spring",
      "rockville",
      "tysons",
    ],
  },
  {
    slug: "minneapolis",
    name: "Minneapolis, MN",
    state: "MN",
    lat: 44.9778,
    lng: -93.265,
    radiusTier: "LARGE",
    aliases: ["st paul", "saint paul", "bloomington mn", "edina", "minnetonka"],
  },
  {
    slug: "detroit",
    name: "Detroit, MI",
    state: "MI",
    lat: 42.3314,
    lng: -83.0458,
    radiusTier: "LARGE",
    aliases: ["dearborn", "troy mi", "warren mi", "royal oak", "southfield"],
  },
  {
    slug: "columbus",
    name: "Columbus, OH",
    state: "OH",
    lat: 39.9612,
    lng: -82.9988,
    radiusTier: "MID",
    aliases: ["dublin oh", "westerville", "hilliard"],
  },
  {
    slug: "indianapolis",
    name: "Indianapolis, IN",
    state: "IN",
    lat: 39.7684,
    lng: -86.1581,
    radiusTier: "MID",
    aliases: ["carmel", "fishers", "greenwood"],
  },
  {
    slug: "kansas-city",
    name: "Kansas City, MO",
    state: "MO",
    lat: 39.0997,
    lng: -94.5786,
    radiusTier: "MID",
    aliases: ["overland park", "olathe", "lees summit"],
  },
  {
    slug: "raleigh",
    name: "Raleigh, NC",
    state: "NC",
    lat: 35.7796,
    lng: -78.6382,
    radiusTier: "MID",
    aliases: ["durham", "cary", "chapel hill", "apex", "morrisville"],
  },
  {
    slug: "salt-lake-city",
    name: "Salt Lake City, UT",
    state: "UT",
    lat: 40.7608,
    lng: -111.891,
    radiusTier: "MID",
    aliases: ["west valley city", "sandy ut", "provo", "ogden", "draper"],
  },
  {
    slug: "new-orleans",
    name: "New Orleans, LA",
    state: "LA",
    lat: 29.9511,
    lng: -90.0715,
    radiusTier: "MID",
    aliases: ["metairie", "kenner"],
  },
  {
    slug: "tucson",
    name: "Tucson, AZ",
    state: "AZ",
    lat: 32.2226,
    lng: -110.9747,
    radiusTier: "MID",
    aliases: ["oro valley", "marana"],
  },
] as const;

/**
 * Poland — curated majors (2026-08). Hand-entered (no GeoNames build step,
 * unlike GENERATED_CITIES) — the 15 largest Polish cities by population.
 * `state` carries the ISO 3166-2:PL voivodeship code (same role US postal
 * codes play for CURATED_METROS); `name` is deliberately ASCII (no
 * diacritics) because `normalizePlace()` in resolve-metro.ts doesn't strip
 * them — an accented name would silently break combobox/typeahead matching.
 */
export const PL_METROS: readonly UsMetro[] = [
  {
    slug: "warsaw",
    name: "Warsaw, Poland",
    state: "MZ",
    lat: 52.2297,
    lng: 21.0122,
    radiusTier: "LARGE",
    country: "PL",
    aliases: [],
  },
  {
    slug: "krakow",
    name: "Krakow, Poland",
    state: "MA",
    lat: 50.0647,
    lng: 19.945,
    radiusTier: "LARGE",
    country: "PL",
    aliases: [],
  },
  {
    slug: "lodz",
    name: "Lodz, Poland",
    state: "LD",
    lat: 51.7592,
    lng: 19.456,
    radiusTier: "MID",
    country: "PL",
    aliases: [],
  },
  {
    slug: "wroclaw",
    name: "Wroclaw, Poland",
    state: "DS",
    lat: 51.1079,
    lng: 17.0385,
    radiusTier: "MID",
    country: "PL",
    aliases: [],
  },
  {
    slug: "poznan",
    name: "Poznan, Poland",
    state: "WP",
    lat: 52.4064,
    lng: 16.9252,
    radiusTier: "MID",
    country: "PL",
    aliases: [],
  },
  {
    slug: "gdansk",
    name: "Gdansk, Poland",
    state: "PM",
    lat: 54.352,
    lng: 18.6466,
    radiusTier: "MID",
    country: "PL",
    aliases: [],
  },
  {
    slug: "szczecin",
    name: "Szczecin, Poland",
    state: "ZP",
    lat: 53.4285,
    lng: 14.5528,
    radiusTier: "MID",
    country: "PL",
    aliases: [],
  },
  {
    slug: "bydgoszcz",
    name: "Bydgoszcz, Poland",
    state: "KP",
    lat: 53.1235,
    lng: 18.0084,
    radiusTier: "MID",
    country: "PL",
    aliases: [],
  },
  {
    slug: "lublin",
    name: "Lublin, Poland",
    state: "LU",
    lat: 51.2465,
    lng: 22.5684,
    radiusTier: "SMALL",
    country: "PL",
    aliases: [],
  },
  {
    slug: "bialystok",
    name: "Bialystok, Poland",
    state: "PD",
    lat: 53.1325,
    lng: 23.1688,
    radiusTier: "SMALL",
    country: "PL",
    aliases: [],
  },
  {
    slug: "katowice",
    name: "Katowice, Poland",
    state: "SL",
    lat: 50.2649,
    lng: 19.0238,
    radiusTier: "SMALL",
    country: "PL",
    aliases: [],
  },
  {
    slug: "gdynia",
    name: "Gdynia, Poland",
    state: "PM",
    lat: 54.5189,
    lng: 18.5305,
    radiusTier: "SMALL",
    country: "PL",
    aliases: [],
  },
  {
    slug: "czestochowa",
    name: "Czestochowa, Poland",
    state: "SL",
    lat: 50.8118,
    lng: 19.1203,
    radiusTier: "SMALL",
    country: "PL",
    aliases: [],
  },
  {
    slug: "radom",
    name: "Radom, Poland",
    state: "MZ",
    lat: 51.4027,
    lng: 21.1471,
    radiusTier: "SMALL",
    country: "PL",
    aliases: [],
  },
  {
    slug: "sosnowiec",
    name: "Sosnowiec, Poland",
    state: "SL",
    lat: 50.2863,
    lng: 19.1041,
    radiusTier: "SMALL",
    country: "PL",
    aliases: [],
  },
] as const;

/**
 * The full gazetteer the app selects from: the curated majors (rich aliases +
 * stable slugs) FIRST, then the generated US + Canada cities ≥100k population
 * (deduped against the curated set in scripts/build-places-gazetteer.ts), then
 * the curated Poland majors. The Market step, `metroBySlug`, and discovery
 * all read this — so adding a city here makes it selectable AND discoverable
 * with no other wiring.
 */
export const US_METROS: readonly UsMetro[] = [
  ...CURATED_METROS,
  ...GENERATED_CITIES,
  ...PL_METROS,
];

/** Radius (km) for a metro, derived from its tier. */
export function radiusKmForMetro(metro: UsMetro): number {
  return RADIUS_KM_BY_TIER[metro.radiusTier];
}
