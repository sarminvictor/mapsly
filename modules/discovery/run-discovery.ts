// modules/discovery/run-discovery.ts · the user-facing Discovery executor
// (Phase 2). Spans many (category × metro) cells in ONE request, serving fresh
// cells from the DB ($0) and re-fetching stale/never cells from DataForSEO.
//
// This is the runtime that wires together:
//   - lib/cell                    · canonical cellKey + 182-day freshness
//   - lib/geo/resolve-metro       · metro anchor + radius + per-row stamping
//   - decideDiscoveryPlan         · fresh-vs-refetch + pre-flight cost
//   - mapsSearch (inside CronRun)  · the only external call, cost-counted
//   - mapsRowToPersist / persist  · DfS row → Business insert
//   - extractOpenStatus           · queryable operating status per row
//
// Invoked by the internal /api/internal/run-discovery worker route (cron
// context), NOT directly from a server action — so the "no live API in user
// request path" invariant holds (.claude/rules/cost-discipline.md). The server
// action only ENQUEUES a PENDING Discovery row.

import { createHash } from "node:crypto";

import { cellKey as makeCellKey, nextStaleAt } from "@/lib/cell";
import { withCronRun } from "@/lib/cost/cost-counter";
import { metroBySlug, nearestMetro } from "@/lib/geo/resolve-metro";
import { radiusKmForMetro } from "@/lib/geo/us-metros";
import prisma from "@/lib/prisma";
import {
  mapsRowToPersist,
  persistBusinessRow,
} from "@/modules/business-discovery/persist";
import { mapsSearch } from "@/services/dataforseo";

import { decideDiscoveryPlan } from "./freshness-decision";
import { extractOpenStatus, type OpenStatus } from "./open-status";

/** One cell the caller wants discovered. */
export interface DiscoveryCellRequest {
  /** DfS category slug, e.g. "medical_spa" — also the cellKey's category part. */
  categorySlug: string;
  /** BusinessCategory row id (resolves the DfS id + TrackedLocation FK). */
  categoryId: string;
  /** Metro slug from the gazetteer, e.g. "miami". */
  metroSlug: string;
  /** ISO-2 country, default "US". */
  country?: string;
}

export interface RunDiscoveryInput {
  agencyId: string;
  userId: string;
  cells: DiscoveryCellRequest[];
  /** Per-cell DfS limit. Defaults to 100; clamped to [1, 1000]. */
  limitPerCell?: number;
}

export interface DiscoveryCellSummary {
  cellKey: string;
  trackedLocationId: string;
  outcome: "SERVED_FROM_DB" | "REFETCHED" | "DISCOVERED_NEW" | "FAILED";
  businessCount: number;
  dfsCostUsd: number;
  errorMessage: string | null;
}

export interface RunDiscoverySummary {
  discoveryId: string;
  status: "READY" | "PARTIAL" | "FAILED";
  cellCount: number;
  freshCount: number;
  refetchedCount: number;
  totalBusinesses: number;
  totalCostUsd: number;
  cells: DiscoveryCellSummary[];
}

/** Stable idempotency key: sorted cellKeys + the requesting user. */
export function discoveryIdempotencyKey(
  cellKeys: string[],
  userId: string,
): string {
  const sorted = [...cellKeys].sort();
  const payload = `${userId}::${sorted.join(",")}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

function clampLimit(n: number | undefined): number {
  const v = n ?? 100;
  if (!Number.isFinite(v)) return 100;
  return Math.min(1000, Math.max(1, Math.floor(v)));
}

/**
 * Run a multi-cell Discovery. Upserts the Discovery row by idempotency key
 * (re-running the same request resumes the existing row instead of forking a
 * second one), then processes each cell: fresh cells serve from the DB,
 * stale/never cells re-fetch from DfS inside a CronRun.
 */
export async function runDiscovery(
  input: RunDiscoveryInput,
  now: Date = new Date(),
): Promise<RunDiscoverySummary> {
  const country0 = (c?: string) => (c ?? "US").toUpperCase();
  const limit = clampLimit(input.limitPerCell);

  const cellKeys = input.cells.map((c) =>
    makeCellKey(c.categorySlug, c.metroSlug, country0(c.country)),
  );
  const idempotencyKey = discoveryIdempotencyKey(cellKeys, input.userId);

  // Upsert the Discovery row (PENDING → RUNNING). On a re-run we reuse it.
  const discovery = await prisma.discovery.upsert({
    where: { idempotencyKey },
    create: {
      agencyId: input.agencyId,
      requestedByUserId: input.userId,
      idempotencyKey,
      status: "RUNNING",
      cellKeys,
      cellCount: cellKeys.length,
    },
    update: { status: "RUNNING", cellKeys, cellCount: cellKeys.length },
    select: { id: true },
  });

  const cellSummaries: DiscoveryCellSummary[] = [];
  let totalBusinesses = 0;
  let totalCostUsd = 0;
  let freshCount = 0;
  let refetchedCount = 0;
  let anyFailed = false;

  for (let i = 0; i < input.cells.length; i += 1) {
    const cell = input.cells[i];
    const country = country0(cell.country);
    const key = cellKeys[i];

    try {
      const metro = metroBySlug(cell.metroSlug);
      if (!metro) {
        throw new Error(`unknown metro "${cell.metroSlug}"`);
      }
      const radiusKm = radiusKmForMetro(metro);

      // Find/create the cell's TrackedLocation. The existing unique key is
      // (categoryId, city, province, country) — we use the metro NAME as the
      // `city` value (the metro-key swap is a separate guarded migration).
      const tracked = await upsertTrackedLocation({
        categoryId: cell.categoryId,
        metroSlug: cell.metroSlug,
        metroName: metro.name,
        country,
        lat: metro.lat,
        lng: metro.lng,
        radiusKm,
        now,
      });

      // Decide fresh-vs-refetch for this single cell.
      const plan = decideDiscoveryPlan(
        [
          {
            cellKey: key,
            lastDiscoveredAt: tracked.lastDiscoveredAt,
            expectedListings: tracked.lastTotalAvailable ?? limit,
          },
        ],
        now,
      );
      const decision = plan.cells[0];

      if (decision.outcome === "SERVED_FROM_DB") {
        freshCount += 1;
        const count = await prisma.business.count({ where: { cellKey: key } });
        totalBusinesses += count;
        await prisma.discoveryCell.upsert({
          where: {
            discoveryId_trackedLocationId: {
              discoveryId: discovery.id,
              trackedLocationId: tracked.id,
            },
          },
          create: {
            discoveryId: discovery.id,
            trackedLocationId: tracked.id,
            cellKey: key,
            outcome: "SERVED_FROM_DB",
            businessCount: count,
            dfsCostUsd: 0,
          },
          update: { outcome: "SERVED_FROM_DB", businessCount: count },
        });
        cellSummaries.push({
          cellKey: key,
          trackedLocationId: tracked.id,
          outcome: "SERVED_FROM_DB",
          businessCount: count,
          dfsCostUsd: 0,
          errorMessage: null,
        });
        continue;
      }

      // REFETCH path · the only external call, inside a CronRun.
      refetchedCount += 1;
      const fetchResult = await refetchCell({
        cell,
        metroLat: metro.lat,
        metroLng: metro.lng,
        radiusKm,
        country,
        cellKey: key,
        metroName: metro.name,
        limit,
      });

      totalBusinesses += fetchResult.created;
      totalCostUsd += fetchResult.costUsd;

      const outcome: "REFETCHED" | "DISCOVERED_NEW" =
        fetchResult.created > 0 ? "DISCOVERED_NEW" : "REFETCHED";

      await prisma.$transaction([
        prisma.trackedLocation.update({
          where: { id: tracked.id },
          data: {
            lastDiscoveredAt: now,
            nextStaleAt: nextStaleAt(now),
            lastDiscoveryStatus: "OK",
            lastTotalAvailable: fetchResult.totalAvailable ?? undefined,
            lastRunAt: now,
            totalRuns: { increment: 1 },
            totalNewFound: { increment: fetchResult.created },
            businessCount: { increment: fetchResult.created },
            totalCostUsd: { increment: fetchResult.costUsd },
          },
        }),
        prisma.discoveryCell.upsert({
          where: {
            discoveryId_trackedLocationId: {
              discoveryId: discovery.id,
              trackedLocationId: tracked.id,
            },
          },
          create: {
            discoveryId: discovery.id,
            trackedLocationId: tracked.id,
            cellKey: key,
            outcome,
            businessCount: fetchResult.returned,
            dfsCostUsd: fetchResult.costUsd,
          },
          update: {
            outcome,
            businessCount: fetchResult.returned,
            dfsCostUsd: fetchResult.costUsd,
          },
        }),
        prisma.cellSnapshot.create({
          data: {
            trackedLocationId: tracked.id,
            cellKey: key,
            capturedAt: now,
            businessCount: fetchResult.returned,
            totalAvailable: fetchResult.totalAvailable ?? undefined,
            openCount: fetchResult.openCount,
            closedForeverCount: fetchResult.closedForeverCount,
          },
        }),
      ]);

      cellSummaries.push({
        cellKey: key,
        trackedLocationId: tracked.id,
        outcome,
        businessCount: fetchResult.returned,
        dfsCostUsd: fetchResult.costUsd,
        errorMessage: null,
      });
    } catch (err) {
      anyFailed = true;
      const message =
        err instanceof Error ? err.message : "discovery cell failed";
      cellSummaries.push({
        cellKey: key,
        trackedLocationId: "",
        outcome: "FAILED",
        businessCount: 0,
        dfsCostUsd: 0,
        errorMessage: message,
      });
    }
  }

  const ok = cellSummaries.some((c) => c.outcome !== "FAILED");
  const status: RunDiscoverySummary["status"] = anyFailed
    ? ok
      ? "PARTIAL"
      : "FAILED"
    : "READY";

  await prisma.discovery.update({
    where: { id: discovery.id },
    data: {
      status,
      freshCount,
      refetchedCount,
      totalBusinesses,
      totalCostUsd,
      finishedAt: now,
    },
  });

  return {
    discoveryId: discovery.id,
    status,
    cellCount: input.cells.length,
    freshCount,
    refetchedCount,
    totalBusinesses,
    totalCostUsd,
    cells: cellSummaries,
  };
}

interface UpsertTrackedInput {
  categoryId: string;
  metroSlug: string;
  metroName: string;
  country: string;
  lat: number;
  lng: number;
  radiusKm: number;
  now: Date;
}

/**
 * Find or create the TrackedLocation for a cell. The legacy unique is
 * (categoryId, city, province, country); we key `city` on the metro name and
 * leave `province` null for the metro-level row. Stamps metroSlug + radiusKm +
 * verifiedAt so the row is consistent with the cell model.
 */
async function upsertTrackedLocation(input: UpsertTrackedInput): Promise<{
  id: string;
  lastDiscoveredAt: Date | null;
  lastTotalAvailable: number | null;
}> {
  const existing = await prisma.trackedLocation.findFirst({
    where: {
      categoryId: input.categoryId,
      city: input.metroName,
      province: null,
      country: input.country,
    },
    select: { id: true, lastDiscoveredAt: true, lastTotalAvailable: true },
  });
  if (existing) {
    // Backfill metro keying if missing (idempotent).
    await prisma.trackedLocation.update({
      where: { id: existing.id },
      data: {
        metroSlug: input.metroSlug,
        lat: input.lat,
        lng: input.lng,
        radiusKm: input.radiusKm,
      },
    });
    return existing;
  }

  const created = await prisma.trackedLocation.create({
    data: {
      categoryId: input.categoryId,
      city: input.metroName,
      province: null,
      country: input.country,
      lat: input.lat,
      lng: input.lng,
      radiusKm: input.radiusKm,
      verifiedAt: input.now,
      metroSlug: input.metroSlug,
    },
    select: { id: true, lastDiscoveredAt: true, lastTotalAvailable: true },
  });
  return created;
}

interface RefetchCellInput {
  cell: DiscoveryCellRequest;
  metroLat: number;
  metroLng: number;
  radiusKm: number;
  country: string;
  cellKey: string;
  metroName: string;
  limit: number;
}

interface RefetchCellResult {
  returned: number;
  created: number;
  costUsd: number;
  totalAvailable: number | null;
  openCount: number;
  closedForeverCount: number;
}

/**
 * Re-fetch one cell from DataForSEO inside a CronRun, persist each row with the
 * cell's metro/cellKey/openStatus/anchorDistance stamped on, and return the
 * snapshot counts. ONE CronRun wraps the call so the cost lands on one ledger
 * row (matches the run.ts admin-discovery pattern).
 */
async function refetchCell(
  input: RefetchCellInput,
): Promise<RefetchCellResult> {
  return withCronRun("agency:discovery", async () => {
    const page = await mapsSearch({
      categories: [input.cell.categorySlug],
      location_coordinate: `${input.metroLat.toFixed(6)},${input.metroLng.toFixed(
        6,
      )},${input.radiusKm}`,
      language_code: "en",
      limit: input.limit,
    });

    let created = 0;
    let openCount = 0;
    let closedForeverCount = 0;

    for (const row of page.items) {
      // extractOpenStatus reads work_time.work_hours.current_status. DfS types
      // work_time as `unknown` (passthrough), so hand it the narrowed shape its
      // signature expects — a plain structural pass, no double-cast.
      const openStatus: OpenStatus = extractOpenStatus({
        work_time: row.work_time as {
          work_hours?: { current_status?: string | null } | null;
        } | null,
      });
      if (openStatus === "OPEN") openCount += 1;
      if (openStatus === "CLOSED_FOREVER") closedForeverCount += 1;

      const shape = mapsRowToPersist(row, {
        city: input.metroName,
        province: null,
        country: input.country,
      });
      if (!shape) continue;

      // Stamp the discovery-time geo + status onto the persisted row.
      const anchor =
        shape.lat != null && shape.lng != null
          ? nearestMetro(shape.lat, shape.lng)
          : null;
      const stamped = {
        ...shape,
        metroSlug: input.cell.metroSlug,
        cellKey: input.cellKey,
        openStatus,
        anchorDistanceKm: anchor?.distanceKm ?? null,
        crossMetroDupe: (anchor?.containingSlugs.length ?? 0) > 1,
      };

      const outcome = await persistBusinessRow(stamped, "DISCOVERY");
      if (outcome === "created") created += 1;
    }

    return {
      returned: page.items.length,
      created,
      costUsd: page.rawCostUsd,
      totalAvailable: page.totalCount,
      openCount,
      closedForeverCount,
    };
  });
}
