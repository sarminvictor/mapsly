/**
 * Local dev helper · runs the S.6 local-intent pipeline end-to-end
 * against one business so Viktor can verify /search before merging.
 *
 *   1. discover-local-intent  → upsert Keyword + BusinessKeyword rows
 *                                with source="template" + DfS volumes
 *   2. aggregate-cell-maps    → one Maps SERP query per templated
 *                                keyword anchored to the cell centroid
 *
 * Run via:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx \
 *     scripts/run-local-intent.ts [businessId]
 *
 * Without a businessId argument, defaults to The Injectionist
 * (auto-discovered as the business with the most BusinessKeyword rows
 * today). After it runs, reload /search → Maps column should populate.
 *
 * Read-from-DB, writes-to-DB (idempotent upserts). Real DfS API calls
 * are made · cost ≈ $0.05 per run for a medspa cell.
 */

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { discoverLocalIntentForBusiness } from "@/modules/search-visibility/discover-local-intent";
import { aggregateCellMaps } from "@/modules/search-visibility/aggregate-cell-maps";

async function main() {
  const argBizId = process.argv[2];

  // 1. Resolve target business · arg wins, else fallback to top-by-
  //    BusinessKeyword-count.
  let businessId: string;
  if (argBizId) {
    businessId = argBizId;
  } else {
    const top = await prisma.businessKeyword.groupBy({
      by: ["businessId"],
      _count: { _all: true },
      orderBy: { _count: { businessId: "desc" } },
      take: 1,
    });
    if (top.length === 0) {
      throw new Error(
        "No BusinessKeyword rows in DB · pass a businessId arg explicitly.",
      );
    }
    businessId = top[0]!.businessId;
  }

  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      city: true,
      country: true,
      category: true,
      lat: true,
      lng: true,
      googleCid: true,
    },
  });
  if (!biz) throw new Error(`Business ${businessId} not found.`);

  console.log("TARGET BUSINESS");
  console.log(`  id        = ${biz.id}`);
  console.log(`  name      = ${biz.name}`);
  console.log(`  city      = ${biz.city} (${biz.country})`);
  console.log(`  category  = ${biz.category}`);
  console.log(`  lat/lng   = ${biz.lat}, ${biz.lng}`);
  console.log(`  googleCid = ${biz.googleCid ?? "(null · won't match in Maps)"}`);

  // 2. Discover local-intent keywords for this business.
  console.log(`\n[1/2] discover-local-intent · upsert templated Keyword +`);
  console.log(`      BusinessKeyword rows + fetch DfS volumes...`);
  const discover = await withCronRun(
    "manual:run-local-intent-discover",
    () => discoverLocalIntentForBusiness(biz.id),
  );
  console.log(`      status         = ${discover.status}`);
  console.log(`      industry       = ${discover.industry}`);
  console.log(`      keywordsBuilt  = ${discover.keywordsBuilt}`);
  console.log(`      keywordsTracked= ${discover.keywordsTracked}`);
  console.log(`      volumePopulated= ${discover.volumePopulated}`);

  // 3. Aggregate-cell-maps · needs the centroid.
  if (biz.lat == null || biz.lng == null) {
    console.log(`\n[2/2] SKIPPED · business has no lat/lng (no Maps query)`);
  } else if (!biz.city || !biz.country) {
    console.log(`\n[2/2] SKIPPED · business has no city/country`);
  } else {
    console.log(`\n[2/2] aggregate-cell-maps · Maps SERP per templated kw...`);
    const aggregate = await withCronRun(
      "manual:run-local-intent-cell",
      () =>
        aggregateCellMaps({
          city: biz.city!,
          country: biz.country!,
          centroidLat: biz.lat!,
          centroidLng: biz.lng!,
        }),
    );
    console.log(`      cellBusinessCount  = ${aggregate.cellBusinessCount}`);
    console.log(`      keywordsQueried    = ${aggregate.keywordsQueried}`);
    console.log(`      serpRowsWritten    = ${aggregate.serpRowsWritten}`);
    console.log(`      matchedBusinesses  = ${aggregate.matchedBusinessIds.length}`);
    console.log(
      `      our biz in matches = ${aggregate.matchedBusinessIds.includes(biz.id) ? "YES ✓" : "no"}`,
    );
  }

  // 4. Quick verification · re-read the BusinessKeyword state.
  console.log(`\nPOST-RUN STATE`);
  const templateRows = await prisma.businessKeyword.count({
    where: { businessId: biz.id, source: "template" },
  });
  const mapsRanked = await prisma.businessKeyword.count({
    where: { businessId: biz.id, source: "template", latestMapsRank: { not: null } },
  });
  const mapsTop3 = await prisma.businessKeyword.count({
    where: { businessId: biz.id, source: "template", latestMapsRank: { lte: 3 } },
  });
  const orgRanked = await prisma.businessKeyword.count({
    where: {
      businessId: biz.id,
      source: "template",
      latestOrganicRank: { not: null },
    },
  });
  console.log(`  template rows     : ${templateRows}`);
  console.log(`  with Maps rank    : ${mapsRanked}`);
  console.log(`  Maps top 3        : ${mapsTop3}`);
  console.log(`  with Organic rank : ${orgRanked}`);
  console.log(
    `\n→ Reload /search · the visibility table should now show ${templateRows} rows`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
