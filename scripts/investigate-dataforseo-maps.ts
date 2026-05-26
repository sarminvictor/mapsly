#!/usr/bin/env tsx

/**
 * One-off investigation script · pulls real samples from the three
 * DataForSEO endpoints that can return businesses for a (category ×
 * geo) cell. Designed to be read alongside the output, not committed
 * long-term — but kept in the repo so a future Viktor can re-run.
 *
 * Endpoints exercised:
 *   1. Business Listings · /v3/business_data/business_listings/search/live
 *      The Maps category search we already use. Filter by category +
 *      coordinate radius. Returns up to 1000 businesses.
 *
 *   2. Google Maps SERP · /v3/serp/google/maps/live/advanced
 *      Keyword-driven Maps search. "med spa miami" instead of a
 *      category filter. Returns ranked SERP-style results (top 20).
 *
 *   3. Categories · /v3/business_data/business_listings/categories
 *      The full taxonomy. Read this once to populate the picker —
 *      free (one-off) request that returns ~4k category strings.
 *
 * Cost: ~$0.005 total for the three calls.
 *
 * Each call uses `limit: 3` (where supported) so we get readable output
 * without spending real budget. The categories endpoint doesn't accept
 * a limit; we slice client-side.
 *
 * Run:
 *   pnpm tsx scripts/investigate-dataforseo-maps.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const USERNAME =
  process.env.DATAFORSEO_USERNAME ?? process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;
if (!USERNAME || !PASSWORD) {
  throw new Error("DATAFORSEO_USERNAME / DATAFORSEO_PASSWORD missing");
}
const AUTH =
  "Basic " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");

const MIAMI = { lat: 25.7617, lng: -80.1918, radiusKm: 5 };

async function callDfs<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ envelope: T; raw: unknown }> {
  const res = await fetch(`https://api.dataforseo.com${path}`, {
    method: "POST",
    headers: {
      Authorization: AUTH,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([body]),
  });
  const raw = await res.json();
  if (!res.ok) {
    console.error(`HTTP ${res.status}`, raw);
    throw new Error(`HTTP ${res.status}`);
  }
  return { envelope: raw as T, raw };
}

interface Envelope {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: Array<{
    status_code: number;
    status_message: string;
    cost?: number;
    result_count?: number;
    result?: unknown[];
  }>;
}

function divider(label: string): void {
  console.log("\n" + "═".repeat(78));
  console.log("  " + label);
  console.log("═".repeat(78));
}

async function endpointOne_businessListings(): Promise<void> {
  divider(
    "ENDPOINT 1 · /v3/business_data/business_listings/search/live · limit=3",
  );
  console.log("REQUEST BODY:");
  const body = {
    categories: ["medical_spa"],
    location_coordinate: `${MIAMI.lat},${MIAMI.lng},${MIAMI.radiusKm}`,
    language_code: "en",
    limit: 3,
  };
  console.log(JSON.stringify(body, null, 2));

  const { envelope } = await callDfs<Envelope>(
    "/v3/business_data/business_listings/search/live",
    body,
  );
  console.log(
    `\nENVELOPE: status_code=${envelope.status_code} · cost=$${envelope.cost} · tasks=${envelope.tasks?.length}`,
  );
  const task = envelope.tasks?.[0];
  console.log(
    `TASK: status_code=${task?.status_code} · cost=$${task?.cost} · result_count=${task?.result_count}`,
  );

  const result = (task?.result?.[0] ?? {}) as {
    total_count?: number;
    count?: number;
    items?: unknown[];
  };
  console.log(
    `RESULT: total_count=${result.total_count} · returned=${result.count}`,
  );

  const items = (result.items ?? []) as Array<Record<string, unknown>>;
  console.log(`\nROW SAMPLES (${items.length}):`);
  for (let i = 0; i < items.length; i += 1) {
    const r = items[i]!;
    console.log(`\n--- row[${i}] ---`);
    console.log(JSON.stringify(r, null, 2));
  }
}

async function endpointTwo_googleMapsSerp(): Promise<void> {
  divider(
    "ENDPOINT 2 · /v3/serp/google/maps/live/advanced · keyword='med spa miami' · depth=3",
  );
  console.log("REQUEST BODY:");
  const body = {
    keyword: "med spa miami",
    language_code: "en",
    location_coordinate: `${MIAMI.lat},${MIAMI.lng},${MIAMI.radiusKm}`,
    depth: 3,
  };
  console.log(JSON.stringify(body, null, 2));

  const { envelope } = await callDfs<Envelope>(
    "/v3/serp/google/maps/live/advanced",
    body,
  );
  console.log(
    `\nENVELOPE: status_code=${envelope.status_code} · cost=$${envelope.cost} · tasks=${envelope.tasks?.length}`,
  );
  const task = envelope.tasks?.[0];
  console.log(
    `TASK: status_code=${task?.status_code} · cost=$${task?.cost} · result_count=${task?.result_count}`,
  );

  const result = (task?.result?.[0] ?? {}) as {
    items_count?: number;
    items?: unknown[];
  };
  console.log(`RESULT: returned=${result.items_count}`);

  const items = (result.items ?? []) as Array<Record<string, unknown>>;
  console.log(`\nROW SAMPLES (${items.length}):`);
  for (let i = 0; i < Math.min(items.length, 3); i += 1) {
    const r = items[i]!;
    console.log(`\n--- row[${i}] ---`);
    console.log(JSON.stringify(r, null, 2));
  }
}

async function endpointThree_categories(): Promise<void> {
  divider(
    "ENDPOINT 3 · /v3/business_data/business_listings/categories · (taxonomy)",
  );
  console.log("REQUEST BODY: (none — GET semantics, but DfS uses POST)");

  const { envelope } = await callDfs<Envelope>(
    "/v3/business_data/business_listings/categories",
    {},
  );
  console.log(
    `\nENVELOPE: status_code=${envelope.status_code} · cost=$${envelope.cost} · tasks=${envelope.tasks?.length}`,
  );
  const task = envelope.tasks?.[0];
  console.log(
    `TASK: status_code=${task?.status_code} · cost=$${task?.cost} · result_count=${task?.result_count}`,
  );

  const result = (task?.result ?? []) as Array<{
    category_code?: string;
    category_name?: string;
  }>;
  console.log(`RESULT: ${result.length} categories total`);

  console.log("\nSAMPLE — categories containing 'spa' or 'med':");
  const filtered = result.filter((c) => {
    const name = (c.category_name ?? "").toLowerCase();
    const code = (c.category_code ?? "").toLowerCase();
    return (
      name.includes("spa") ||
      code.includes("medical") ||
      code.includes("med_") ||
      code === "medical_spa"
    );
  });
  for (const c of filtered.slice(0, 20)) {
    console.log(`  ${c.category_code?.padEnd(40)} ${c.category_name}`);
  }
  console.log(`  (${filtered.length} total matches)`);
}

async function main(): Promise<void> {
  console.log("=".repeat(78));
  console.log("  DataForSEO Maps · investigation");
  console.log(
    `  Anchor: Miami centroid (${MIAMI.lat}, ${MIAMI.lng}) · ${MIAMI.radiusKm}km`,
  );
  console.log("=".repeat(78));

  await endpointOne_businessListings();
  await endpointTwo_googleMapsSerp();
  await endpointThree_categories();

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
