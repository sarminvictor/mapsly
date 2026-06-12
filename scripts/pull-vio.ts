// scripts/pull-vio.ts — one-off · pull VIO Med Spa reviews + website Lighthouse
// DIRECTLY via DataForSEO (no UI). Reviews bypass the unreliable pingback by
// polling task_get (harvestPendingReviewsForBusiness). Reuses the app's own
// tested functions so the data persists to the DB exactly like the cron path.
//
// Run:
//   DATAFORSEO_PINGBACK_TOKEN=poll-only MAPSLY_PUBLIC_URL=https://www.mapsly.ai \
//     pnpm tsx scripts/pull-vio.ts
//
// (DATAFORSEO_PINGBACK_TOKEN is only needed so reviewsTaskPost can build a
//  pingback URL; we never rely on the callback — we poll. The prod webhook
//  rejects the placeholder token, which is harmless since harvest clears the
//  cursor.)

import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { triggerReviewPullForBusiness } from "@/modules/reviews/trigger-pull";
import { harvestPendingReviewsForBusiness } from "@/modules/reviews/harvest-pending";
import { collectWebsiteForBatch } from "@/modules/website-intel/collect-website-intel";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const vio = await prisma.business.findFirst({
    where: {
      OR: [
        { googleCid: "6644322410248047" },
        { slug: { contains: "vio-med-spa" } },
      ],
    },
    select: {
      id: true,
      slug: true,
      name: true,
      googleCid: true,
      website: true,
      reviewCount: true,
      rating: true,
      pendingReviewsTaskId: true,
    },
  });
  if (!vio) {
    console.error("VIO not found");
    process.exit(1);
  }
  console.log("[vio]", JSON.stringify(vio));
  const before = await prisma.review.count({ where: { businessId: vio.id } });
  console.log("[reviews] IN DB before:", before);

  // ── Website Lighthouse (direct DfS Lighthouse Live) ───────────────────────
  try {
    const lh = await withCronRun("script:vio-website", () =>
      collectWebsiteForBatch([vio.id]),
    );
    console.log("[lighthouse]", JSON.stringify(lh));
  } catch (e) {
    console.error("[lighthouse] threw:", e instanceof Error ? e.message : e);
  }

  // ── Reviews · post the DfS task, then poll task_get (no pingback) ─────────
  if (!vio.pendingReviewsTaskId) {
    try {
      const posted = await withCronRun("script:vio-reviews-post", () =>
        triggerReviewPullForBusiness(vio.id, { mode: "manual" }),
      );
      console.log("[reviews] task posted:", JSON.stringify(posted));
    } catch (e) {
      console.error(
        "[reviews] task_post threw:",
        e instanceof Error ? e.message : e,
      );
    }
  } else {
    console.log("[reviews] task already in flight:", vio.pendingReviewsTaskId);
  }

  let harvested = false;
  for (let i = 0; i < 30; i++) {
    const r = await withCronRun("script:vio-reviews-harvest", () =>
      harvestPendingReviewsForBusiness(vio.id),
    );
    console.log(`[reviews] harvest #${i + 1}:`, JSON.stringify(r));
    if (r.harvested) {
      harvested = true;
      break;
    }
    if (r.reason !== "not_ready") break;
    await sleep(20000);
  }

  const after = await prisma.business.findUnique({
    where: { id: vio.id },
    select: {
      reviewCount: true,
      rating: true,
      reviewsFirstPulledAt: true,
      pendingReviewsTaskId: true,
    },
  });
  const inDb = await prisma.review.count({ where: { businessId: vio.id } });
  console.log("==== DONE ====");
  console.log("[reviews] IN DB after:", inDb, "· harvested:", harvested);
  console.log("[business] after:", JSON.stringify(after));
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
