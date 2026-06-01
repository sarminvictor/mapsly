/**
 * RESEARCH PROBE · ads-intelligence DataForSEO endpoint survey.
 *
 * One-off, manual, read-only-to-our-DB. Calls a curated list of
 * ad-relevant DataForSEO endpoints against ONE business (default: The
 * Injectionist) and prints, per endpoint:
 *   - operation tag + path
 *   - the exact request body we send
 *   - DataForSEO's reported per-call cost (task.cost, real USD)
 *   - result_count + a trimmed view of the first result
 *   - for SERP: the `paid` (ad) block specifically
 *
 * Goal: show Viktor the real request/response/cost shape for each
 * endpoint so we can decide which to wire into the /ads page rework.
 *
 * Run:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx \
 *     scripts/probe-ads-dfs.ts ["Business Name fragment" | businessId]
 *
 * Cost: each probe is cheap (< $0.15). Total run < $1. The script prints
 * a running total and a final SUM so there are no surprises. Nothing is
 * written to our DB except the CronRun cost-tracking rows (audit trail).
 */

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "@/services/dataforseo";

// ---- helpers ------------------------------------------------------------

function pretty(v: unknown, max = 1800): string {
  const s = JSON.stringify(v, null, 2);
  return s.length > max
    ? s.slice(0, max) + `\n… [truncated ${s.length - max} chars]`
    : s;
}

function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(
      website.startsWith("http") ? website : `https://${website}`,
    );
    return u.hostname.replace(/^www\./, "");
  } catch {
    return (
      website
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0] ?? null
    );
  }
}

interface Probe {
  operation: string;
  path: string;
  body: Record<string, unknown>;
  /** What we're hoping to learn · printed as a header. */
  note: string;
  /** Pull out the interesting slice of the result for display. */
  highlight?: (result: unknown[]) => unknown;
}

let totalCost = 0;

async function runProbe(p: Probe): Promise<void> {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`▶ ${p.operation}`);
  console.log(`  POST ${p.path}`);
  console.log(`  why: ${p.note}`);
  console.log(`  request body:\n${pretty([p.body], 1200)}`);
  try {
    const out = await withCronRun(`probe:${p.operation}`, () =>
      dataforSeoPost<Record<string, unknown>>({
        path: p.path,
        operation: p.operation,
        body: p.body,
        timeoutMs: 60_000,
        acceptableTaskStatusCodes: [20000],
      }),
    );
    const cost = out.rawCostUsd ?? 0;
    totalCost += cost;
    console.log(
      `  ✓ cost: $${cost.toFixed(4)}  · result_count: ${out.result.length}`,
    );
    const view = p.highlight ? p.highlight(out.result) : out.result[0];
    console.log(`  result (trimmed):\n${pretty(view)}`);
  } catch (err) {
    console.log(
      `  ✗ FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---- main ---------------------------------------------------------------

async function main() {
  const arg = process.argv[2] ?? "Injectionist";

  // No `select` → Prisma returns every scalar column, so we don't have to
  // guess the website/domain column name.
  const biz = await prisma.business.findFirst({
    where: arg.match(/^[a-z0-9]{20,}$/i)
      ? { id: arg }
      : { name: { contains: arg, mode: "insensitive" } },
  });
  if (!biz) throw new Error(`No business matching "${arg}".`);

  const b = biz as Record<string, unknown>;
  const website =
    (b.website as string) ?? (b.domain as string) ?? (b.url as string) ?? null;
  const domain = domainOf(website);
  const city = (b.city as string) ?? null;
  const country = (b.country as string) ?? null;
  const lat = (b.lat as number) ?? null;
  const lng = (b.lng as number) ?? null;

  console.log("TARGET BUSINESS");
  console.log(`  id        = ${b.id}`);
  console.log(`  name      = ${b.name}`);
  console.log(`  category  = ${b.category}`);
  console.log(`  city      = ${city} (${country})`);
  console.log(`  lat/lng   = ${lat}, ${lng}`);
  console.log(`  website   = ${website ?? "(none)"}`);
  console.log(`  domain    = ${domain ?? "(none)"}`);
  console.log(`  googleCid = ${(b.googleCid as string) ?? "(none)"}`);

  // location_code 2124 = Canada, 2840 = US. Pick from country.
  const locationCode = country === "CA" || country === "Canada" ? 2124 : 2840;
  const languageCode = "en";

  // A small, real set of this medspa's service keywords for the
  // keyword-metrics + ad-traffic probes. Kept tiny to keep cost low.
  const sampleKeywords = [
    `botox ${city ?? "calgary"}`.toLowerCase(),
    `lip filler ${city ?? "calgary"}`.toLowerCase(),
    `medical spa ${city ?? "calgary"}`.toLowerCase(),
  ];

  // ===================================================================
  // PROBE LIST · reconcile with Agent C's catalog before running.
  // Each entry is ad-intelligence-relevant. Edit freely.
  // ===================================================================
  const probes: Probe[] = [
    {
      operation: "keywords_data.google_ads.search_volume",
      path: "/v3/keywords_data/google_ads/search_volume/live",
      note: "CPC + competition + monthly volume for this biz's service keywords (what advertising on them costs).",
      body: {
        keywords: sampleKeywords,
        location_code: locationCode,
        language_code: languageCode,
      },
      highlight: (r) => r.slice(0, 5),
    },
    {
      operation: "keywords_data.google_ads.keywords_for_site",
      path: "/v3/keywords_data/google_ads/keywords_for_site/live",
      note: "Ad keywords Google associates with this domain + their CPC/competition.",
      body: domain
        ? {
            target: domain,
            location_code: locationCode,
            language_code: languageCode,
            sort_by: "search_volume",
          }
        : { target: "REQUIRES_DOMAIN" },
      highlight: (r) => r.slice(0, 5),
    },
    {
      operation: "keywords_data.google_ads.ad_traffic_by_keywords",
      path: "/v3/keywords_data/google_ads/ad_traffic_by_keywords/live",
      note: "Estimated impressions/clicks/cost if THEY ran ads on these keywords at a given bid.",
      body: {
        keywords: sampleKeywords,
        location_code: locationCode,
        language_code: languageCode,
        bid: 5.0,
        match: "exact",
      },
      highlight: (r) => r.slice(0, 5),
    },
    {
      operation: "serp.google.organic.advanced (paid block)",
      path: "/v3/serp/google/organic/live/advanced",
      note: "WHO is running search ads on this keyword right now (competitor ads in SERP).",
      body: {
        keyword: sampleKeywords[0],
        location_code: locationCode,
        language_code: languageCode,
        device: "desktop",
        depth: 20,
      },
      highlight: (r) => {
        const first = r[0] as
          | { items?: Array<Record<string, unknown>> }
          | undefined;
        const items = first?.items ?? [];
        const paid = items.filter((i) => i.type === "paid");
        return { paid_count: paid.length, paid_items: paid.slice(0, 5) };
      },
    },
  ];

  for (const p of probes) {
    await runProbe(p);
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(`TOTAL DataForSEO cost this run: $${totalCost.toFixed(4)}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
