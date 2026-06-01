/**
 * Validate P5 AI creative insights cheaply (1 LLM call, no Apify): pull the
 * Calgary med-spa cell's stored Meta creatives + services, run analyzeAdCreatives,
 * upsert AdMarketInsight, and print the structured serviceMix + promos.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/validate-ai-insights.ts
 */

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import {
  analyzeAdCreatives,
  DEFAULT_AD_INSIGHTS_MODEL,
  type CreativeForAnalysis,
} from "@/services/ai";

async function main() {
  const cat = "Medical spa",
    city = "Calgary",
    country = "CA";

  const rows = await prisma.adMarketAdvertiser.findMany({
    where: { category: cat, city, country, platform: "META", isActive: true },
    select: { creatives: true },
  });
  const creatives: CreativeForAnalysis[] = [];
  for (const r of rows) {
    if (!Array.isArray(r.creatives)) continue;
    for (const c of r.creatives as Array<Record<string, unknown>>) {
      if (c && typeof c.body === "string" && c.body.trim()) {
        creatives.push({
          body: c.body,
          format: typeof c.format === "string" ? c.format : null,
          platforms: Array.isArray(c.platforms)
            ? (c.platforms as string[])
            : [],
        });
      }
    }
  }
  const svc = await prisma.businessService.findMany({
    where: {
      business: { category: cat, city, isActive: true },
      isActive: true,
    },
    select: { name: true },
  });
  const services = [...new Set(svc.map((s) => s.name.toLowerCase()))];
  console.log(`Creatives: ${creatives.length} · services: ${services.length}`);

  const insights = await withCronRun("manual:validate-ai-insights", () =>
    analyzeAdCreatives({ category: cat, city, services, creatives }),
  );

  console.log("\n=== SERVICE MIX ===");
  for (const s of insights.serviceMix)
    console.log(`  ${s.ads} ads · ${s.service}`);
  console.log("\n=== PROMOS ===");
  for (const p of insights.promos)
    console.log(`  ${p.label}: ${p.offer}${p.price ? ` (${p.price})` : ""}`);

  await prisma.adMarketInsight.upsert({
    where: {
      category_city_country_platform: {
        category: cat,
        city,
        country,
        platform: "META",
      },
    },
    create: {
      category: cat,
      city,
      country,
      platform: "META",
      serviceMix: insights.serviceMix,
      promos: insights.promos,
      creativesAnalyzed: creatives.length,
      model: DEFAULT_AD_INSIGHTS_MODEL,
    },
    update: {
      serviceMix: insights.serviceMix,
      promos: insights.promos,
      creativesAnalyzed: creatives.length,
      model: DEFAULT_AD_INSIGHTS_MODEL,
      generatedAt: new Date(),
    },
  });
  console.log("\n✓ AdMarketInsight upserted");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
