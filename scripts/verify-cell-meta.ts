/**
 * End-to-end verifier for the cell-meta advertiser-FACET pipeline.
 *
 * Resolves a market cell from the DB (default: dentist / San Francisco / US),
 * runs ONE real Meta Ad Library search through the fixed actor (which now emits
 * the advertiser facet — "who advertises for this search" — even when Meta
 * withholds the per-creative results query), and upserts AdMarketAdvertiser
 * rows, matching advertisers back to our indexed businesses where possible.
 * Then it dumps what landed + the CronRun cost.
 *
 * Cost: one warmed Apify run — a few cents (verified ~$0.052 for a 5-term cell).
 * Writes only the intended prod rows: AdMarketAdvertiser, Business.fbPageId (for
 * matched advertisers), and the CronRun telemetry. Everything else is read-only.
 *
 * RUN (loads .env.local for DATABASE_URL + APIFY_TOKEN via dotenv below — the
 * `@/` alias resolves automatically from tsconfig under tsx):
 *
 *   pnpm exec tsx scripts/verify-cell-meta.ts
 *   pnpm exec tsx scripts/verify-cell-meta.ts "dentist" "San Francisco" "US"
 */

import "dotenv/config";
import { config as loadEnv } from "dotenv";
// Belt-and-suspenders: explicitly load .env.local (dotenv/config above reads
// .env; this overlays the local secrets file regardless of cwd).
loadEnv({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { collectCellMeta } from "@/modules/ads-intel/collect-cell-meta";

const [, , catArg, cityArg, countryArg] = process.argv;
const CATEGORY = catArg ?? "dentist";
const CITY = cityArg ?? "San Francisco";
const COUNTRY = (countryArg ?? "US").toUpperCase();

// Loose ILIKE fragments — match so a "Dentist" / "Dental clinic" category and a
// "San Francisco, CA" city label both resolve. Use a 4-char category stem
// ("dent" → dentist/dental). province must be CA or null.
const CATEGORY_STEM = CATEGORY.slice(0, 4).toLowerCase();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set — is .env.local present?");
    process.exit(1);
  }
  if (!process.env.APIFY_TOKEN) {
    console.error("APIFY_TOKEN not set — add it to .env.local before running.");
    process.exit(1);
  }

  console.log(
    `\nResolving cell · category~="${CATEGORY}" city~="${CITY}" country=${COUNTRY}`,
  );
  console.log(
    `  (category ILIKE '%${CATEGORY_STEM}%', city ILIKE '%${CITY.toLowerCase()}%', province=CA|null)\n`,
  );

  // 1 · resolve the cell's businesses from the DB.
  const businesses = await prisma.business.findMany({
    where: {
      category: { contains: CATEGORY_STEM, mode: "insensitive" },
      city: { contains: CITY, mode: "insensitive" },
    },
    take: 200,
    select: { id: true, name: true, fbPageId: true },
  });

  console.log(`Found ${businesses.length} business(es) in the cell.`);
  for (const b of businesses.slice(0, 8)) {
    console.log(
      `  · ${b.name}${b.fbPageId ? ` (fbPageId=${b.fbPageId})` : ""}`,
    );
  }
  if (businesses.length > 8) console.log(`  … +${businesses.length - 8} more`);

  if (businesses.length === 0) {
    console.log(
      `\nCell not in DB — seed businesses for "${CATEGORY} / ${CITY}" first, then re-run.`,
    );
    await prisma.$disconnect();
    process.exit(0);
  }

  // 2 · run the cell-meta collection inside an open CronRun (the Apify adapter
  // requires the cost-counter context). AI off — facet-only runs skip it anyway.
  const businessIds = businesses.map((b) => b.id);
  const t0 = Date.now();
  let cronRunId = "";
  const out = await withCronRun("verify:cell-meta", async (ctx) => {
    cronRunId = ctx.runId;
    return collectCellMeta(
      { category: CATEGORY, city: CITY, country: COUNTRY, businessIds },
      { ai: false },
    );
  });
  const secs = Math.round((Date.now() - t0) / 1000);

  console.log(`\nDONE ${secs}s`);
  console.log(`  advertisers upserted : ${out.advertisers}`);
  console.log(`  creatives captured   : ${out.creatives}`);
  console.log(`  run cost (Apify)     : $${out.runUsd}`);
  console.log(`  search terms         : ${out.searchTerms.join(" | ")}`);
  if (out.errors.length)
    console.log(`  errors               : ${out.errors.join("; ")}`);

  // 3 · read back the AdMarketAdvertiser rows for the cell + the match count.
  const advs = await prisma.adMarketAdvertiser.findMany({
    where: {
      category: CATEGORY,
      city: CITY,
      country: COUNTRY,
      platform: "META",
      isActive: true,
    },
    orderBy: { activeAdCount: "desc" },
    select: {
      pageName: true,
      pageId: true,
      activeAdCount: true,
      matchedBusinessId: true,
    },
  });
  const matched = advs.filter((a) => a.matchedBusinessId).length;

  console.log(
    `\n=== AdMarketAdvertiser · ${CATEGORY} / ${CITY}: ${advs.length} active (${matched} matched to our businesses) ===`,
  );
  for (const a of advs.slice(0, 8)) {
    const mine = a.matchedBusinessId ? ` [MATCHED→${a.matchedBusinessId}]` : "";
    console.log(
      `  ${a.pageName} · ${a.activeAdCount} ads · pageId=${a.pageId}${mine}`,
    );
  }

  // 4 · print the CronRun cost (the cost-counter's accumulated total).
  if (cronRunId) {
    const run = await prisma.cronRun.findUnique({
      where: { id: cronRunId },
      select: { job: true, status: true, costUsd: true },
    });
    console.log(
      `\nCronRun ${cronRunId} · ${run?.job} · ${run?.status} · costUsd=$${run?.costUsd ?? 0}`,
    );
  }

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
