#!/usr/bin/env tsx

/**
 * Build lib/geo/places.generated.ts — the US + Canada city gazetteer the
 * Market step + discovery select from.
 *
 * Source: GeoNames `cities15000` (CC-BY 4.0) — every populated place ≥ 15k
 * worldwide, with real coordinates + population + admin1 (state/province).
 * We keep US + Canada cities with population ≥ 100,000, drop sections of cities
 * (boroughs like Brooklyn — feature_code PPLX), and DEDUPE against the curated
 * majors in us-metros.ts (same name+state, or a curated metro's alias) so the
 * majors keep their rich aliases + stable slugs and we only append NEW cities.
 *
 * Every coordinate is real GeoNames data — no hand-entry, no fakes. Discovery
 * searches DfS by coordinate, which covers US + Canada fully, so every emitted
 * city is DfS-discoverable.
 *
 * Run:
 *   pnpm tsx scripts/build-places-gazetteer.ts
 * Downloads the GeoNames files to $GEONAMES_DIR (default a temp dir) if absent.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURATED_METROS, type RadiusTier } from "../lib/geo/us-metros";
import { normalizePlace } from "../lib/geo/resolve-metro";

const MIN_POPULATION = 100_000;
const DIR = process.env.GEONAMES_DIR ?? join(tmpdir(), "mapsly-geonames");
const OUT = join(process.cwd(), "lib/geo/places.generated.ts");

/** GeoNames CA admin1 is numeric; map province NAME → ISO-2 abbreviation. */
const CA_ABBREV: Record<string, string> = {
  Alberta: "AB",
  "British Columbia": "BC",
  Manitoba: "MB",
  "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL",
  "Nova Scotia": "NS",
  Ontario: "ON",
  "Prince Edward Island": "PE",
  Quebec: "QC",
  Saskatchewan: "SK",
  Yukon: "YT",
  "Northwest Territories": "NT",
  Nunavut: "NU",
};

/** Sections of a city (boroughs/neighborhoods) — excluded; we want whole cities. */
const EXCLUDED_FEATURE_CODES = new Set(["PPLX"]);

function ensureData(): void {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const cities = join(DIR, "cities15000.txt");
  const admin1 = join(DIR, "admin1CodesASCII.txt");
  if (!existsSync(cities)) {
    console.log("[gazetteer] downloading cities15000.zip…");
    execSync(
      `curl -sSL -o "${join(DIR, "cities15000.zip")}" https://download.geonames.org/export/dump/cities15000.zip && unzip -o -q "${join(DIR, "cities15000.zip")}" -d "${DIR}"`,
      { stdio: "inherit" },
    );
  }
  if (!existsSync(admin1)) {
    console.log("[gazetteer] downloading admin1CodesASCII.txt…");
    execSync(
      `curl -sSL -o "${admin1}" https://download.geonames.org/export/dump/admin1CodesASCII.txt`,
      { stdio: "inherit" },
    );
  }
}

function radiusTierForPop(pop: number): RadiusTier {
  if (pop >= 2_000_000) return "MEGA";
  if (pop >= 800_000) return "LARGE";
  if (pop >= 350_000) return "MID";
  if (pop >= 150_000) return "SMALL";
  return "MICRO";
}

function kebab(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface GenCity {
  slug: string;
  name: string;
  state: string;
  country: "US" | "CA";
  lat: number;
  lng: number;
  radiusTier: RadiusTier;
  pop: number;
}

function main(): void {
  ensureData();

  // admin1 map: "US.NY" → "New York", "CA.08" → "Ontario"
  const adminName = new Map<string, string>();
  for (const line of readFileSync(join(DIR, "admin1CodesASCII.txt"), "utf8")
    .split("\n")
    .filter(Boolean)) {
    const [code, name] = line.split("\t");
    if (code && name) adminName.set(code, name);
  }

  // Curated dedup sets: precise name+state, plus alias-only (collapses boroughs).
  const curatedNameState = new Set<string>();
  const curatedAliases = new Set<string>();
  const usedSlugs = new Set<string>();
  for (const m of CURATED_METROS) {
    const cityOnly = m.name.split(",")[0] ?? m.name;
    curatedNameState.add(
      `${normalizePlace(cityOnly)}|${m.state.toLowerCase()}`,
    );
    for (const a of m.aliases) curatedAliases.add(normalizePlace(a));
    usedSlugs.add(m.slug);
  }

  const rows = readFileSync(join(DIR, "cities15000.txt"), "utf8").split("\n");
  const out: GenCity[] = [];
  let skippedCurated = 0;
  let skippedAlias = 0;

  for (const line of rows) {
    if (!line) continue;
    const f = line.split("\t");
    // GeoNames geoname columns (0-indexed): 1 name, 2 asciiname, 4 lat, 5 lng,
    // 7 feature_code, 8 country_code, 10 admin1_code, 14 population.
    const name = f[1];
    const ascii = f[2] ?? f[1] ?? "";
    const lat = Number(f[4]);
    const lng = Number(f[5]);
    const featureCode = f[7] ?? "";
    const country = f[8];
    const admin1 = f[10] ?? "";
    const pop = Number(f[14] ?? "0");

    if (country !== "US" && country !== "CA") continue;
    if (!Number.isFinite(pop) || pop < MIN_POPULATION) continue;
    if (EXCLUDED_FEATURE_CODES.has(featureCode)) continue;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    // state / province → ISO-2
    let state: string;
    if (country === "US") {
      state = admin1; // GeoNames US admin1 is the 2-letter postal code
    } else {
      const provName = adminName.get(`CA.${admin1}`) ?? "";
      state = CA_ABBREV[provName] ?? "";
    }
    if (!state) continue; // unresolved admin → skip (never emit a half-row)

    const cityNorm = normalizePlace(name);
    if (curatedNameState.has(`${cityNorm}|${state.toLowerCase()}`)) {
      skippedCurated++;
      continue;
    }
    if (curatedAliases.has(cityNorm)) {
      skippedAlias++;
      continue;
    }

    // unique slug (curated slugs already reserved)
    let slug = kebab(ascii);
    if (usedSlugs.has(slug)) slug = `${slug}-${state.toLowerCase()}`;
    let n = 2;
    while (usedSlugs.has(slug))
      slug = `${kebab(ascii)}-${state.toLowerCase()}-${n++}`;
    usedSlugs.add(slug);

    out.push({
      slug,
      name: `${name}, ${state}`,
      state,
      country,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      radiusTier: radiusTierForPop(pop),
      pop,
    });
  }

  out.sort((a, b) => b.pop - a.pop);

  const us = out.filter((c) => c.country === "US").length;
  const ca = out.filter((c) => c.country === "CA").length;

  const body = out
    .map(
      (c) =>
        `  { slug: ${JSON.stringify(c.slug)}, name: ${JSON.stringify(c.name)}, state: ${JSON.stringify(c.state)}, country: "${c.country}", lat: ${c.lat}, lng: ${c.lng}, radiusTier: "${c.radiusTier}", aliases: [] },`,
    )
    .join("\n");

  const file = `// lib/geo/places.generated.ts · GENERATED — do not edit by hand.
//
// Produced by \`pnpm tsx scripts/build-places-gazetteer.ts\` from the GeoNames
// \`cities15000\` dataset (US + Canada, population ≥ ${MIN_POPULATION.toLocaleString("en-US")}),
// deduped against the curated majors in us-metros.ts. Re-run to refresh.
//
// Source: https://download.geonames.org/export/dump/cities15000.zip (CC-BY 4.0)
// Counts: ${out.length} cities (${us} US · ${ca} CA). Every coordinate is real
// GeoNames data; discovery searches DfS by coordinate (US+CA fully covered).

import type { UsMetro } from "./us-metros";

export const GENERATED_CITIES: UsMetro[] = [
${body}
];
`;

  writeFileSync(OUT, file, "utf8");
  console.log(
    `[gazetteer] wrote ${out.length} cities (${us} US · ${ca} CA) → ${OUT}`,
  );
  console.log(
    `[gazetteer] deduped: ${skippedCurated} same-as-curated · ${skippedAlias} curated aliases (boroughs/neighborhoods)`,
  );
}

main();
