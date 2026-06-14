// scripts/fix-miami-gaps.ts — cost-optimized gap-fill for qualified Miami
// businesses, reading the audit matrix from /tmp/miami-coverage.json.
//
// Spends DfS credits ONLY where it fills a real gap:
//   - Lighthouse: re-run for businesses with a website but no usable score.
//   - SERP: ranked_keywords for businesses with a domain but no ranks.
//   - Reviews: pull ONLY the never-pulled (skip the 44 "all >12mo" — re-pull
//     returns old reviews → still 0 stored → wasted credits).
// Skips entirely: blanket Google-ads rescan (mostly genuinely no ads).
//
// Run: DATAFORSEO_PINGBACK_TOKEN=poll-only MAPSLY_PUBLIC_URL=https://www.mapsly.ai \
//        pnpm tsx scripts/fix-miami-gaps.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { collectWebsiteForBatch } from "@/modules/website-intel/collect-website-intel";
import { discoverLocalIntentForBusiness } from "@/modules/search-visibility/discover-local-intent";
import { triggerReviewPullForBusiness } from "@/modules/reviews/trigger-pull";
import { harvestPendingReviewsForBusiness } from "@/modules/reviews/harvest-pending";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  reviewCount: number | null;
  reviewsDb: number;
  reviewsFirstPulledAt: string | null;
  kwRanked: number;
  lhScored: boolean;
};

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const n = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

async function main() {
  const rows: Row[] = JSON.parse(
    fs.readFileSync("/tmp/miami-coverage.json", "utf8"),
  );

  const lhIds = rows.filter((r) => r.website && !r.lhScored).map((r) => r.id);
  const serpIds = rows
    .filter((r) => r.kwRanked === 0 && (r.domain || r.website))
    .map((r) => r.id);
  const revIds = rows
    .filter(
      (r) =>
        (r.reviewCount ?? 0) > 0 &&
        r.reviewsDb === 0 &&
        r.reviewsFirstPulledAt === null,
    )
    .map((r) => r.id);

  console.log(
    `[plan] lighthouse=${lhIds.length} · serp=${serpIds.length} · reviews=${revIds.length} (skipping 44 old-review re-pulls + 182 ad rescans)`,
  );

  // ── Lighthouse · concurrency 4 ────────────────────────────────────────────
  const doLighthouse = () =>
    withCronRun("script:fix-lighthouse", async () => {
      let audited = 0;
      let errored = 0;
      await mapLimit(lhIds, 4, async (id, i) => {
        const r = await collectWebsiteForBatch([id]);
        audited += r.audited;
        errored += r.errors.length;
        if ((i + 1) % 5 === 0 || i + 1 === lhIds.length)
          console.log(
            `[lighthouse] ${i + 1}/${lhIds.length} · audited=${audited} errored=${errored}`,
          );
      });
      console.log(`[lighthouse] DONE · audited=${audited} errored=${errored}`);
    });

  // ── SERP ranked_keywords · concurrency 5 ──────────────────────────────────
  const doSerp = () =>
    withCronRun("script:fix-serp", async () => {
      let ran = 0;
      let skipped = 0;
      await mapLimit(serpIds, 5, async (id, i) => {
        try {
          const r = await discoverLocalIntentForBusiness(id);
          if (r.status === "ran") ran += 1;
          else skipped += 1;
        } catch (e) {
          skipped += 1;
          console.warn(
            `[serp] ${id} threw: ${e instanceof Error ? e.message : e}`,
          );
        }
        if ((i + 1) % 5 === 0 || i + 1 === serpIds.length)
          console.log(
            `[serp] ${i + 1}/${serpIds.length} · ran=${ran} skipped=${skipped}`,
          );
      });
      console.log(`[serp] DONE · ran=${ran} skipped=${skipped}`);
    });

  // ── Reviews · only the never-pulled, post + poll harvest ──────────────────
  const doReviews = () =>
    Promise.all(
      revIds.map(async (id) => {
        await withCronRun("script:fix-reviews-post", () =>
          triggerReviewPullForBusiness(id, { mode: "manual" }),
        );
        for (let i = 0; i < 20; i++) {
          const r = await withCronRun("script:fix-reviews-harvest", () =>
            harvestPendingReviewsForBusiness(id),
          );
          if (r.harvested || r.reason !== "not_ready") {
            console.log(`[reviews] ${id}:`, JSON.stringify(r));
            break;
          }
          await sleep(15000);
        }
      }),
    );

  await Promise.all([doLighthouse(), doSerp(), doReviews()]);

  // ── Cost tally ────────────────────────────────────────────────────────────
  const runs = await prisma.cronRun.findMany({
    where: { job: { startsWith: "script:fix-" } },
    orderBy: { startedAt: "desc" },
    take: 60,
    select: { job: true, costUsd: true, startedAt: true },
  });
  const since = Date.now() - 60 * 60 * 1000;
  const recent = runs.filter((r) => r.startedAt.getTime() > since);
  const total = recent.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  console.log("==== COST (this run) ====");
  console.log(
    `total DfS spend: $${total.toFixed(4)} across ${recent.length} CronRuns`,
  );

  await prisma.$disconnect?.();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
