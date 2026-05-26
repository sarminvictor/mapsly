/**
 * Discovery run executor · the one path that grows the Business index.
 *
 * Invoked by `/admin/discovery` server action when the admin clicks
 * "Run discovery" on a `TrackedLocation` row. Wraps:
 *   1. Open a `DiscoveryRun` row (status: RUNNING)
 *   2. Call DataForSEO Maps with the cell's coords + category + radius
 *   3. Pipe results through `mapsRowToPersist` + `persistBusinessRow`
 *   4. Tally new vs duplicate vs error counts
 *   5. Close the run (status: OK / PARTIAL / FAILED) + cost
 *   6. Update the cell's denormalized aggregates
 *   7. Revalidate cache tags so the admin page reflects the new state
 *
 * Cost: $0.001 per run (one Maps call, regardless of limit up to 1000).
 * The 24h KV cache on `mapsSearch` means re-running the same cell
 * within a day returns cached rows at zero additional cost — admin can
 * safely retry without rebilling.
 */

import { revalidateTag } from "next/cache";

import { withCronRun } from "@/lib/cost/cost-counter";
import prisma from "@/lib/prisma";
import { mapsSearch } from "@/services/dataforseo";
import { DATAFORSEO_UNIT_COST_USD } from "@/services/dataforseo/pricing";

import { mapsRowToPersist, persistBusinessRow } from "./persist";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export interface DiscoveryRunSummary {
  runId: string;
  status: "OK" | "PARTIAL" | "FAILED";
  totalReturned: number;
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
  const limit = clampLimit(input.limit ?? DEFAULT_LIMIT);

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
  let newBusinesses = 0;
  let duplicates = 0;
  let errors = 0;
  let errorMessage: string | null = null;
  // Default to the flat estimate; we'll overwrite with the actual billed
  // cost reported by DfS once the response lands. If the API throws
  // before reporting cost, the estimate is the safest under-attribution
  // (CronRun.costUsd still increments correctly via incrementCost
  // inside mapsSearch — see services/dataforseo/maps-search.ts).
  let costUsd: number = DATAFORSEO_UNIT_COST_USD.mapsSearch;

  try {
    // Per `.claude/rules/cost-discipline.md` every DataForSEO call must
    // run inside an open CronRun. Admin-triggered runs use a dedicated
    // job name ("admin:discovery-run") so the unified cost ledger can
    // distinguish admin clicks from scheduled cron work in reports.
    //
    // Two ledgers, one truth:
    //   - CronRun.costUsd · charged by mapsSearch via incrementCost with
    //     DfS's actual `task.cost` (matches the invoice exactly).
    //   - DiscoveryRun.costUsd · we copy `result.rawCostUsd` below so the
    //     per-cell audit row carries the same exact value.
    const result = await withCronRun("admin:discovery-run", () =>
      mapsSearch({
        categories: [cell.category.dataforseoId],
        location_coordinate: `${cell.lat.toFixed(6)},${cell.lng.toFixed(6)},${cell.radiusKm}`,
        language_code: "en",
        limit,
      }),
    );
    totalReturned = result.items.length;
    costUsd = result.rawCostUsd;

    for (const row of result.items) {
      const shape = mapsRowToPersist(row, {
        city: cell.city,
        province: cell.province,
        country: cell.country,
      });
      if (!shape) {
        errors += 1;
        continue;
      }
      const outcome = await persistBusinessRow(shape, "DISCOVERY");
      if (outcome === "created") newBusinesses += 1;
      else if (outcome === "duplicate") duplicates += 1;
      else errors += 1;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Discovery run failed.";
  }

  const status = chooseStatus({
    errorMessage,
    totalReturned,
    errors,
  });

  await prisma.$transaction([
    prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status,
        totalReturned,
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
        totalNewFound: { increment: newBusinesses },
        totalCostUsd: { increment: costUsd },
        businessCount: { increment: newBusinesses },
        // Re-affirm "verified" — cell is still yielding live rows
        verifiedAt: totalReturned > 0 ? new Date() : undefined,
      },
    }),
  ]);

  revalidateTag("admin-discovery", "seconds");
  if (newBusinesses > 0) {
    revalidateTag("seo-sitemap", "days");
  }

  return {
    runId: run.id,
    status,
    totalReturned,
    newBusinesses,
    duplicates,
    errors,
    costUsd,
    errorMessage,
  };
}

function clampLimit(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(raw)), MAX_LIMIT);
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
