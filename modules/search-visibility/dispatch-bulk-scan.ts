// modules/search-visibility/dispatch-bulk-scan.ts
//
// Bulk-scan dispatcher. Used by:
//   - Admin "Run SERP scan" single-row button → 1-business input
//   - Admin bulk action → N-business input
//   - Weekly cron (S.4 · ships in PR2) → ALL paid-cell businesses
//
// Pipeline:
//   1. Filter input businesses through paid-cell gate (`filterEligibleBusinesses`)
//      · skip cells without a paid account · same rule as reviews
//   2. For each eligible business · enqueue Worker job (mode=biz)
//   3. Group eligible businesses by (city, country) · for each UNIQUE cell ·
//      enqueue ONE Worker job (mode=cell) · this is the optimization the
//      user asked for (no duplicate aggregate runs)
//   4. Return immediately with {queued, failed, cellsAggregated}
//
// Sequential fallback when BOXLY_WORKER_BASE_URL is unset · mirrors the
// pattern from `modules/reviews/dispatch-bulk-pull.ts`.

import {
  enqueueCallbackWebhooks,
  BoxlyWorkerError,
  type WorkerJob,
} from "@/lib/boxly-worker/client";
import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";
import prisma from "@/lib/prisma";
import { filterEligibleBusinesses } from "@/lib/reviews/should-collect";

import {
  discoverKeywordsForBusiness,
  type DiscoverKeywordsResult,
} from "./discover-keywords";
import {
  aggregateCellMaps,
  type AggregateCellMapsResult,
} from "./aggregate-cell-maps";

export interface DispatchSearchScanInput {
  businessIds: string[];
  /** Trigger source · "manual" (admin single) | "bulk" (admin bulk) | "cron". */
  mode: "manual" | "bulk" | "cron";
  /** Maps top-N keywords per cell. Default 30 per the plan. */
  cellTopN?: number;
}

export interface DispatchSearchScanResult {
  strategy: "worker-enqueue" | "sequential-fallback";
  requested: number;
  /** Businesses that passed the paid-cell gate. */
  eligibleBusinesses: number;
  /** Worker path: jobs enqueued · Sequential: per-biz discoveries completed. */
  queuedOrTriggered: number;
  /** Worker path: rejected · Sequential: skipped/threw. */
  failedOrSkipped: number;
  /** Unique cells we'll run an aggregate Maps pass for. */
  cellsAggregated: number;
  /** Worker path · taskIds sample · ignore on sequential. */
  taskIdSample?: string[];
  /** Sequential path · per-business discovery summary · null on worker. */
  sequentialResults?: Array<{
    businessId: string;
    status: DiscoverKeywordsResult["status"];
    keywordsTracked: number;
  }>;
  /** Sequential path · per-cell aggregate summary · null on worker. */
  sequentialCellResults?: AggregateCellMapsResult[];
}

interface CellGroup {
  city: string;
  country: string;
  centroidLat: number;
  centroidLng: number;
  businessIds: string[];
}

export async function dispatchSearchScan(
  input: DispatchSearchScanInput,
): Promise<DispatchSearchScanResult> {
  const requested = input.businessIds.length;
  if (requested === 0) {
    return zeroResult();
  }

  // 1. Paid-cell gate · drops every business in a cell without paid accounts.
  const eligibleIds = await filterEligibleBusinesses(input.businessIds);

  if (eligibleIds.length === 0) {
    return {
      ...zeroResult(),
      requested,
      eligibleBusinesses: 0,
    };
  }

  // 2. Group eligible businesses by (city, country) cell + compute centroid.
  const cellGroups = await groupBusinessesByCell(eligibleIds);

  // 3. Dispatch · worker or sequential fallback.
  if (workerAvailable()) {
    return dispatchViaWorker(input, requested, eligibleIds, cellGroups);
  }
  return dispatchSequential(input, requested, eligibleIds, cellGroups);
}

// ---- worker path ----------------------------------------------------------

async function dispatchViaWorker(
  input: DispatchSearchScanInput,
  requested: number,
  eligibleIds: string[],
  cellGroups: CellGroup[],
): Promise<DispatchSearchScanResult> {
  const callbackBase = getMapslyPublicUrl();
  const callbackUrl = `${callbackBase}/api/internal/trigger-search-scan`;
  const ts = Date.now();
  const topN = input.cellTopN ?? 30;

  // One job per eligible business (mode=biz) + one job per unique cell
  // (mode=cell). Both target the same callback endpoint; the endpoint
  // dispatches on payload.mode.
  const jobs: WorkerJob[] = [
    ...eligibleIds.map(
      (businessId): WorkerJob => ({
        taskId: `mapsly-search-biz-${businessId}-${ts}`,
        url: callbackUrl,
        payload: { mode: "biz", businessId },
        callerLabel: `mapsly:search-${input.mode}`,
        timeoutSec: 60,
      }),
    ),
    ...cellGroups.map(
      (cell): WorkerJob => ({
        taskId: `mapsly-search-cell-${cell.city}-${cell.country}-${ts}`,
        url: callbackUrl,
        payload: {
          mode: "cell",
          city: cell.city,
          country: cell.country,
          centroidLat: cell.centroidLat,
          centroidLng: cell.centroidLng,
          topN,
        },
        callerLabel: `mapsly:search-${input.mode}-cell`,
        timeoutSec: 120, // up to N keywords × ~2s
      }),
    ),
  ];

  try {
    const result = await enqueueCallbackWebhooks(jobs);
    return {
      strategy: "worker-enqueue",
      requested,
      eligibleBusinesses: eligibleIds.length,
      queuedOrTriggered: result.queued,
      failedOrSkipped: result.failed,
      cellsAggregated: cellGroups.length,
      taskIdSample: result.taskIds.slice(0, 5),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[search-visibility:dispatch] worker enqueue failed (${err instanceof BoxlyWorkerError ? "BoxlyWorkerError" : "unknown"}): ${message} · falling back to sequential`,
    );
    return dispatchSequential(input, requested, eligibleIds, cellGroups);
  }
}

// ---- sequential fallback --------------------------------------------------

async function dispatchSequential(
  _input: DispatchSearchScanInput,
  requested: number,
  eligibleIds: string[],
  cellGroups: CellGroup[],
): Promise<DispatchSearchScanResult> {
  const perBiz: DispatchSearchScanResult["sequentialResults"] = [];
  let triggered = 0;
  let skipped = 0;

  for (const businessId of eligibleIds) {
    try {
      const r = await discoverKeywordsForBusiness(businessId);
      perBiz.push({
        businessId,
        status: r.status,
        keywordsTracked: r.keywordsTracked,
      });
      if (r.status === "ran") triggered += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      console.warn(
        `[search-visibility:dispatch] sequential ${businessId} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // After all per-biz discoveries land, run the cell aggregates.
  const perCell: AggregateCellMapsResult[] = [];
  for (const cell of cellGroups) {
    try {
      const r = await aggregateCellMaps({
        city: cell.city,
        country: cell.country,
        centroidLat: cell.centroidLat,
        centroidLng: cell.centroidLng,
      });
      perCell.push(r);
    } catch (err) {
      console.warn(
        `[search-visibility:dispatch] sequential cell ${cell.city}/${cell.country} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    strategy: "sequential-fallback",
    requested,
    eligibleBusinesses: eligibleIds.length,
    queuedOrTriggered: triggered,
    failedOrSkipped: skipped,
    cellsAggregated: perCell.length,
    sequentialResults: perBiz,
    sequentialCellResults: perCell,
  };
}

// ---- helpers --------------------------------------------------------------

function workerAvailable(): boolean {
  return Boolean(
    process.env.BOXLY_WORKER_BASE_URL && process.env.BOXLY_WORKER_AUTH_TOKEN,
  );
}

function zeroResult(): DispatchSearchScanResult {
  return {
    strategy: workerAvailable() ? "worker-enqueue" : "sequential-fallback",
    requested: 0,
    eligibleBusinesses: 0,
    queuedOrTriggered: 0,
    failedOrSkipped: 0,
    cellsAggregated: 0,
  };
}

/**
 * Group business IDs by (city, country) cell + compute the GPS centroid
 * (mean lat / mean lng) from each cell's members. Centroid is what Maps
 * queries use as `location_coordinate` so we don't bias toward any one
 * business.
 *
 * Returns one CellGroup per unique cell. Businesses with null lat/lng
 * are kept in their cell but don't contribute to the centroid · if
 * EVERY business in a cell lacks coords we skip the cell entirely
 * (Maps query can't run without a coordinate).
 */
async function groupBusinessesByCell(
  businessIds: string[],
): Promise<CellGroup[]> {
  const businesses = await prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: {
      id: true,
      city: true,
      country: true,
      lat: true,
      lng: true,
    },
  });

  const byCell = new Map<
    string,
    {
      city: string;
      country: string;
      latSum: number;
      lngSum: number;
      coordCount: number;
      businessIds: string[];
    }
  >();

  for (const b of businesses) {
    if (!b.city || !b.country) continue;
    const key = `${b.city}|${b.country}`;
    const entry = byCell.get(key) ?? {
      city: b.city,
      country: b.country,
      latSum: 0,
      lngSum: 0,
      coordCount: 0,
      businessIds: [],
    };
    entry.businessIds.push(b.id);
    if (b.lat != null && b.lng != null) {
      entry.latSum += b.lat;
      entry.lngSum += b.lng;
      entry.coordCount += 1;
    }
    byCell.set(key, entry);
  }

  const out: CellGroup[] = [];
  for (const entry of byCell.values()) {
    if (entry.coordCount === 0) continue; // no Maps query possible
    out.push({
      city: entry.city,
      country: entry.country,
      centroidLat: entry.latSum / entry.coordCount,
      centroidLng: entry.lngSum / entry.coordCount,
      businessIds: entry.businessIds,
    });
  }
  return out;
}
