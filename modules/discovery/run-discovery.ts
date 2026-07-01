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

import pLimit from "p-limit";

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

/**
 * Default per-cell fetch cap. Raised from the old 100 (which silently
 * truncated every real market — e.g. "100 dental clinics in Toronto" was
 * never the real count, just wherever the fetch stopped) to DfS's max
 * single-call limit. Discovery is free to the agency (DISCOVERY_PRICE is $0 —
 * docs/pricing-strategy.md), so completeness costs us a few cents, not them.
 * `refetchCell` paginates beyond this via `offset` for markets bigger than
 * one page (docs/enrichment-cost-model.md's own worked example goes to 1442).
 */
const DEFAULT_PER_PAGE_LIMIT = 1000;

function clampLimit(n: number | undefined): number {
  const v = n ?? DEFAULT_PER_PAGE_LIMIT;
  if (!Number.isFinite(v)) return DEFAULT_PER_PAGE_LIMIT;
  return Math.min(1000, Math.max(1, Math.floor(v)));
}

/** Hard ceiling on TOTAL listings fetched per cell across all pages — bounds
 *  worst-case cost/time for a pathological cell while comfortably covering
 *  every realistic market (the cost model's largest worked example is 1442). */
const MAX_TOTAL_PER_CELL = 3000;

/**
 * How many cells run concurrently. The Get-leads flow caps a request at 3
 * markets (MarketStep.tsx's MAX_MARKETS), so this bound is rarely the limiting
 * factor there — every cell in a normal request runs in parallel. It exists
 * for the inline admin path (up to 50 cells), keeping worst-case concurrent
 * DfS calls well under DataForSEO's 10 req/s account-wide limit
 * (.claude/rules/mcp-dataforseo.md) — each `refetchCell` already paginates
 * sequentially within itself, so this bounds cross-CELL concurrency only.
 */
const CELL_CONCURRENCY = 5;

/** One cell's outcome — returned by {@link runOneCell} so `runDiscovery` can
 *  run cells concurrently via `Promise.all` and aggregate afterward instead of
 *  mutating shared totals mid-loop. */
interface CellRunResult {
  summary: DiscoveryCellSummary;
  /** What `totalBusinesses` accumulates — the full DB count for a
   *  SERVED_FROM_DB cell, or only the NEWLY created rows for a refetch (the
   *  existing semantics this preserves; `summary.businessCount` uses
   *  `returned`, not `created`, for a refetch — the two intentionally differ). */
  businessCountForTotal: number;
  costUsd: number;
  isFresh: boolean;
  /** True the moment this cell committed to the refetch path, even if the
   *  fetch itself then failed — mirrors the sequential version's `refetchedCount
   *  += 1` running before the (possibly-throwing) `await refetchCell(...)`. */
  isRefetch: boolean;
  failed: boolean;
}

/**
 * Run a multi-cell Discovery. Upserts the Discovery row by idempotency key
 * (re-running the same request resumes the existing row instead of forking a
 * second one), then processes each cell CONCURRENTLY (bounded by
 * {@link CELL_CONCURRENCY}): fresh cells serve from the DB, stale/never cells
 * re-fetch from DfS inside their own CronRun (AsyncLocalStorage-scoped, so
 * concurrent cells never cross-contaminate cost attribution).
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

  // Every cell is independent (distinct TrackedLocation row, own CronRun via
  // AsyncLocalStorage), so they run CONCURRENTLY — bounded by CELL_CONCURRENCY
  // — instead of one-by-one. `Promise.all` preserves input order regardless of
  // completion order, so `results[i]` still corresponds to `input.cells[i]`.
  const concurrency = pLimit(CELL_CONCURRENCY);
  const results = await Promise.all(
    input.cells.map((cell, i) =>
      concurrency(() =>
        runOneCell(cell, cellKeys[i], discovery.id, limit, now, country0),
      ),
    ),
  );

  const cellSummaries: DiscoveryCellSummary[] = results.map((r) => r.summary);
  let totalBusinesses = 0;
  let totalCostUsd = 0;
  let freshCount = 0;
  let refetchedCount = 0;
  let anyFailed = false;
  for (const r of results) {
    totalBusinesses += r.businessCountForTotal;
    totalCostUsd += r.costUsd;
    if (r.isFresh) freshCount += 1;
    if (r.isRefetch) refetchedCount += 1;
    if (r.failed) anyFailed = true;
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

/**
 * Discover ONE cell: fresh serves from the DB ($0), stale/never re-fetches
 * from DfS inside its own CronRun. Extracted from `runDiscovery`'s old
 * sequential loop body verbatim so cells can run concurrently via
 * `Promise.all` — a per-cell failure returns a FAILED summary rather than
 * throwing, so one bad cell never aborts the others.
 */
async function runOneCell(
  cell: DiscoveryCellRequest,
  key: string,
  discoveryId: string,
  limit: number,
  now: Date,
  country0: (c?: string) => string,
): Promise<CellRunResult> {
  const country = country0(cell.country);
  // Set true the moment this cell commits to the refetch path — mirrors the
  // old sequential code's `refetchedCount += 1` running BEFORE the (possibly
  // throwing) `await refetchCell(...)`, so a failed refetch still counts.
  let isRefetch = false;

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
      const count = await prisma.business.count({ where: { cellKey: key } });
      await prisma.discoveryCell.upsert({
        where: {
          discoveryId_trackedLocationId: {
            discoveryId,
            trackedLocationId: tracked.id,
          },
        },
        create: {
          discoveryId,
          trackedLocationId: tracked.id,
          cellKey: key,
          outcome: "SERVED_FROM_DB",
          businessCount: count,
          dfsCostUsd: 0,
        },
        update: { outcome: "SERVED_FROM_DB", businessCount: count },
      });
      return {
        summary: {
          cellKey: key,
          trackedLocationId: tracked.id,
          outcome: "SERVED_FROM_DB",
          businessCount: count,
          dfsCostUsd: 0,
          errorMessage: null,
        },
        businessCountForTotal: count,
        costUsd: 0,
        isFresh: true,
        isRefetch: false,
        failed: false,
      };
    }

    // REFETCH path · the only external call, inside a CronRun.
    isRefetch = true;
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
            discoveryId,
            trackedLocationId: tracked.id,
          },
        },
        create: {
          discoveryId,
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

    return {
      summary: {
        cellKey: key,
        trackedLocationId: tracked.id,
        outcome,
        businessCount: fetchResult.returned,
        dfsCostUsd: fetchResult.costUsd,
        errorMessage: null,
      },
      businessCountForTotal: fetchResult.created,
      costUsd: fetchResult.costUsd,
      isFresh: false,
      isRefetch: true,
      failed: false,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "discovery cell failed";
    return {
      summary: {
        cellKey: key,
        trackedLocationId: "",
        outcome: "FAILED",
        businessCount: 0,
        dfsCostUsd: 0,
        errorMessage: message,
      },
      businessCountForTotal: 0,
      costUsd: 0,
      isFresh: false,
      isRefetch,
      failed: true,
    };
  }
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
 * snapshot counts. ONE CronRun wraps ALL pages so the cost lands on one ledger
 * row (matches the run.ts admin-discovery pattern).
 *
 * PAGINATION: a full first page (returned === limit) means the market likely
 * has more listings than one page — DfS's own reported `total_count` confirms
 * how many. We page via `offset` until we've covered `totalAvailable` or hit
 * {@link MAX_TOTAL_PER_CELL}, so "the raw market" is the REAL market, not
 * whatever happened to fit in the first page (the old fixed 100-limit silently
 * truncated every real market to at most 100 rows, regardless of how many
 * businesses actually existed).
 */
async function refetchCell(
  input: RefetchCellInput,
): Promise<RefetchCellResult> {
  return withCronRun("agency:discovery", async () => {
    let created = 0;
    let openCount = 0;
    let closedForeverCount = 0;
    let costUsd = 0;
    let totalAvailable: number | null = null;
    let returned = 0;
    let offset = 0;

    while (true) {
      const page = await mapsSearch({
        categories: [input.cell.categorySlug],
        location_coordinate: `${input.metroLat.toFixed(6)},${input.metroLng.toFixed(
          6,
        )},${input.radiusKm}`,
        language_code: "en",
        limit: input.limit,
        offset,
      });

      costUsd += page.rawCostUsd;
      totalAvailable = page.totalCount ?? totalAvailable;
      returned += page.items.length;

      for (const row of page.items) {
        // extractOpenStatus reads work_time.work_hours.current_status. DfS
        // types work_time as `unknown` (passthrough), so hand it the narrowed
        // shape its signature expects — a plain structural pass, no double-cast.
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

      // Stop when: this page wasn't full (that WAS the whole market), or
      // we've covered DfS's reported total, or we've hit the safety ceiling.
      const pageWasFull = page.items.length >= input.limit;
      const coveredTotal = totalAvailable != null && returned >= totalAvailable;
      if (!pageWasFull || coveredTotal || returned >= MAX_TOTAL_PER_CELL) {
        break;
      }
      offset += input.limit;
    }

    return {
      returned,
      created,
      costUsd,
      totalAvailable,
      openCount,
      closedForeverCount,
    };
  });
}
