/**
 * Discovery run executor · the one path that grows the Business index.
 *
 * Invoked by `/admin/discovery` server action when the admin clicks
 * "Run discovery" on a `TrackedLocation` row. Wraps:
 *   1. Open a `DiscoveryRun` row (status: RUNNING)
 *   2. Page through DataForSEO Maps (≤1000/call, offset pagination)
 *      until the requested limit, the cell's `total_count`, or a short
 *      page stops the loop — dense cells no longer truncate at one call
 *   3. Batch-dedup each page (ONE query) then pipe new rows through
 *      `mapsRowToPersist` + `persistBusinessRow`
 *   4. Tally new vs duplicate vs error counts
 *   5. Close the run (status: OK / PARTIAL / FAILED) + cost +
 *      `totalAvailable` (DfS total_count → cell saturation visibility)
 *   6. Update the cell's denormalized aggregates
 *   7. Revalidate cache tags so the admin page reflects the new state
 *
 * Cost: row-priced — ~$0.01 base per page + ~$0.0003 per listing
 * (observed; the adapter bills DfS's actual task.cost). Worst case at
 * MAX_DISCOVERY_LIMIT=10000 ≈ $3.10, under the $5 approval ceiling.
 *
 * Crash-safety: progress CHECKPOINTS after every page — run counts and
 * cell aggregates persist incrementally, so a Vercel 300s timeout on a
 * fully-new 10k pull loses nothing (the run row just stays RUNNING
 * without a finishedAt). Re-clicking resumes cheaply: the 24h KV cache
 * keys per page (re-fetch is free) and batch dedup fast-forwards past
 * already-persisted rows.
 */

import { revalidateTag } from "next/cache";

import { withCronRun } from "@/lib/cost/cost-counter";
import prisma from "@/lib/prisma";
import { mapsSearch } from "@/services/dataforseo";
import { DATAFORSEO_UNIT_COST_USD } from "@/services/dataforseo/pricing";

import { clampLimit, nextPageLimit } from "./pagination";
import {
  findExistingBusinessKeys,
  mapsRowToPersist,
  persistBusinessRow,
} from "./persist";

export interface DiscoveryRunSummary {
  runId: string;
  status: "OK" | "PARTIAL" | "FAILED";
  totalReturned: number;
  /** DfS `total_count` — how many listings exist in the cell, null if
   *  the envelope omitted it. Drives the saturation display. */
  totalAvailable: number | null;
  newBusinesses: number;
  duplicates: number;
  errors: number;
  costUsd: number;
  errorMessage: string | null;
}

/**
 * Execute a discovery run against one `TrackedLocation`. Idempotent in
 * effect — re-running for the same cell within 24h returns the same
 * rows (cached) and writes no new Business rows (CID dedup catches
 * them as duplicates).
 */
export async function runDiscoveryForLocation(input: {
  trackedLocationId: string;
  triggeredByUserId: string | null;
  limit?: number;
}): Promise<DiscoveryRunSummary> {
  const limit = clampLimit(input.limit ?? NaN);

  const cell = await prisma.trackedLocation.findUnique({
    where: { id: input.trackedLocationId },
    select: {
      id: true,
      categoryId: true,
      lat: true,
      lng: true,
      radiusKm: true,
      city: true,
      province: true,
      country: true,
      category: { select: { dataforseoId: true } },
    },
  });
  if (!cell) {
    throw new Error(`TrackedLocation ${input.trackedLocationId} not found`);
  }

  const run = await prisma.discoveryRun.create({
    data: {
      trackedLocationId: cell.id,
      categoryId: cell.categoryId,
      status: "RUNNING",
      triggeredByUserId: input.triggeredByUserId,
      radiusKm: cell.radiusKm,
      limitRequested: limit,
    },
    select: { id: true, startedAt: true },
  });

  let totalReturned = 0;
  let totalAvailable: number | null = null;
  let newBusinesses = 0;
  let duplicates = 0;
  let errors = 0;
  let errorMessage: string | null = null;
  // Default to the flat estimate; pages overwrite with the sum of
  // actual billed costs reported by DfS. If the API throws before
  // reporting cost, the estimate is the safest under-attribution
  // (CronRun.costUsd still increments correctly via incrementCost
  // inside mapsSearch — see services/dataforseo/maps-search.ts).
  let costUsd: number = DATAFORSEO_UNIT_COST_USD.mapsSearch;

  try {
    // Per `.claude/rules/cost-discipline.md` every DataForSEO call must
    // run inside an open CronRun. Admin-triggered runs use a dedicated
    // job name ("admin:discovery-run") so the unified cost ledger can
    // distinguish admin clicks from scheduled cron work in reports.
    // ONE CronRun wraps the whole pagination loop — the run's full cost
    // lands on a single ledger row.
    //
    // Two ledgers, one truth:
    //   - CronRun.costUsd · charged by mapsSearch via incrementCost with
    //     DfS's actual `task.cost` (matches the invoice exactly).
    //   - DiscoveryRun.costUsd · we sum `rawCostUsd` per page below so
    //     the per-cell audit row carries the same exact value.
    await withCronRun("admin:discovery-run", async () => {
      let pagesCost = 0;
      let offset = 0;

      for (;;) {
        const pageLimit = nextPageLimit({
          requestedLimit: limit,
          fetched: totalReturned,
          totalAvailable,
        });
        if (pageLimit === 0) break;

        const page = await mapsSearch({
          categories: [cell.category.dataforseoId],
          location_coordinate: `${cell.lat.toFixed(6)},${cell.lng.toFixed(6)},${cell.radiusKm}`,
          language_code: "en",
          limit: pageLimit,
          offset,
        });

        pagesCost += page.rawCostUsd;
        costUsd = pagesCost;
        if (typeof page.totalCount === "number") {
          totalAvailable = page.totalCount;
        }
        totalReturned += page.items.length;
        offset += page.items.length;

        // Batch dedup — one query per page instead of one per row, so
        // mostly-known pages (re-runs, buffer pulls) stay fast.
        const known = await findExistingBusinessKeys({
          cids: page.items.map((r) => r.cid).filter((v): v is string => !!v),
          placeIds: page.items
            .map((r) => r.place_id)
            .filter((v): v is string => !!v),
        });

        let pageNew = 0;
        for (const row of page.items) {
          const shape = mapsRowToPersist(row, {
            city: cell.city,
            province: cell.province,
            country: cell.country,
          });
          if (!shape) {
            errors += 1;
            continue;
          }
          if (
            (shape.googleCid && known.cids.has(shape.googleCid)) ||
            (shape.googlePlaceId && known.placeIds.has(shape.googlePlaceId))
          ) {
            duplicates += 1;
            continue;
          }
          const outcome = await persistBusinessRow(shape, "DISCOVERY");
          if (outcome === "created") {
            newBusinesses += 1;
            pageNew += 1;
          } else if (outcome === "duplicate") duplicates += 1;
          else errors += 1;
        }

        // CHECKPOINT · persist this page's progress so a function
        // timeout mid-pull can't lose counts or cell aggregates. The
        // run stays RUNNING until the final close below; increments
        // here are per-page deltas (the close does NOT re-add them).
        await prisma.$transaction([
          prisma.discoveryRun.update({
            where: { id: run.id },
            data: {
              totalReturned,
              totalAvailable,
              newBusinesses,
              duplicates,
              errors,
              costUsd,
            },
          }),
          prisma.trackedLocation.update({
            where: { id: cell.id },
            data: {
              businessCount: { increment: pageNew },
              totalNewFound: { increment: pageNew },
              totalCostUsd: { increment: page.rawCostUsd },
            },
          }),
        ]);

        // Short page = cell exhausted (also covers missing total_count).
        if (page.items.length < pageLimit) break;
      }
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Discovery run failed.";
  }

  const status = chooseStatus({
    errorMessage,
    totalReturned,
    errors,
  });

  // Final close. Counts/cost on the cell were already incremented by
  // the per-page checkpoints — only run-level closure fields here.
  await prisma.$transaction([
    prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status,
        totalReturned,
        totalAvailable,
        newBusinesses,
        duplicates,
        errors,
        costUsd,
        errorMessage,
      },
    }),
    prisma.trackedLocation.update({
      where: { id: cell.id },
      data: {
        lastRunAt: new Date(),
        totalRuns: { increment: 1 },
        // Saturation denormalized onto the cell — only when DfS told us
        lastTotalAvailable: totalAvailable ?? undefined,
        // Re-affirm "verified" — cell is still yielding live rows
        verifiedAt: totalReturned > 0 ? new Date() : undefined,
      },
    }),
  ]);

  // Guarded like every sibling module (website-intel, ads-intel,
  // harvest-pending): revalidateTag only works inside a Next request/render
  // scope. From a standalone script (scripts/seed-cell.ts) the rows are
  // already written; the next cached read picks them up.
  try {
    revalidateTag("admin-discovery", "seconds");
    if (newBusinesses > 0) {
      // Must match the cacheTag in listBizSitemapEntries — this fired
      // "seo-sitemap" (a tag nothing listens to) until INC-2026-07-20-66.
      // Profile matches the query's cacheLife("hours").
      revalidateTag("biz-sitemap", "hours");
    }
  } catch {
    // Non-request scope · revalidate is best-effort.
  }

  return {
    runId: run.id,
    status,
    totalReturned,
    totalAvailable,
    newBusinesses,
    duplicates,
    errors,
    costUsd,
    errorMessage,
  };
}

function chooseStatus(input: {
  errorMessage: string | null;
  totalReturned: number;
  errors: number;
}): "OK" | "PARTIAL" | "FAILED" {
  if (input.errorMessage) return "FAILED";
  if (input.errors > 0 && input.totalReturned > 0) return "PARTIAL";
  return "OK";
}
