// Weekly · list-refresh-weekly
//
// Mirror of `daily/list-refresh-daily` (C.8) for lists with
// `refreshCadence='WEEKLY'`. Same DB-only filter-evaluation pipeline:
// re-evaluate the stored filter spec against the Business index and
// reconcile `Lead` rows (insert newly-qualifying, remove de-qualifying
// non-terminal leads, leave terminal leads alone).
//
// The weekly variant additionally hydrates Review / SerpResult /
// AdLibraryEntry signals into the evaluation row so filters keyed off
// those tables (e.g. "unanswered 1★ reviews ≥ 3") work — the daily
// variant leaves these as empty arrays to stay cheap.
//
// No external API calls. Cadence: weekly Monday 14:00 UTC per
// `vercel.json`.

import { revalidateTag } from "next/cache";
import prisma, { Prisma } from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import {
  evaluateSpec,
  type EvaluationRow,
  type FilterSpec,
} from "@/modules/hunter";
import { runBatch, statusFromOutcome } from "../../_lib/batch";
import { parseFilterSpec } from "../../daily/list-refresh-daily/route";

const JOB = "weekly:list-refresh-weekly";
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;
const CANDIDATE_BUSINESS_LIMIT = 5_000;
const REVIEWS_HYDRATION_LIMIT = 50;
const SERP_HYDRATION_LIMIT = 25;
const ADS_HYDRATION_LIMIT = 25;

/** Lead statuses we treat as "agency-engaged" — never remove from a list. */
const TERMINAL_STATUSES = new Set<string>([
  "CONTACTED",
  "REPLIED",
  "WON",
  "LOST",
  "HIDDEN",
]);

interface ListRow {
  id: string;
  agencyId: string;
  category: string | null;
  metro: string | null;
  radiusMi: number | null;
  filterJson: Prisma.JsonValue;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  const listLimit = clampLimitFromEnv(DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

  const lists = (await prisma.list.findMany({
    where: { isActive: true, refreshCadence: "WEEKLY" },
    select: {
      id: true,
      agencyId: true,
      category: true,
      metro: true,
      radiusMi: true,
      filterJson: true,
    },
    take: listLimit,
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
  })) as ListRow[];

  const revalidatedAgencies = new Set<string>();
  const revalidatedLists = new Set<string>();
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalMatched = 0;

  const outcome = await runBatch(lists, async (list: ListRow) => {
    const spec = parseFilterSpec(list.filterJson);
    if (!spec) {
      await prisma.listRefresh.create({
        data: {
          listId: list.id,
          matchesBefore: 0,
          matchesAfter: 0,
          added: 0,
          removed: 0,
        },
      });
      return;
    }

    // Candidate businesses narrowed by list metadata. Hydrate ALL signal
    // tables relevant to weekly filter rows: latest snapshot + audit, plus
    // recent reviews / serp / ads (bounded per business).
    const candidates = await prisma.business.findMany({
      where: {
        isActive: true,
        ...(list.category ? { category: list.category } : {}),
        ...(list.metro ? { city: list.metro } : {}),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        city: true,
        province: true,
        country: true,
        rating: true,
        reviewCount: true,
        photosCount: true,
        website: true,
        phone: true,
        isClaimed: true,
        lastRefreshedAt: true,
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
        },
        lighthouseAudits: {
          take: 1,
          orderBy: { auditedAt: "desc" },
        },
        reviews: {
          take: REVIEWS_HYDRATION_LIMIT,
          orderBy: { postedAt: "desc" },
        },
        serpResults: {
          take: SERP_HYDRATION_LIMIT,
          orderBy: { scannedAt: "desc" },
        },
        adLibraryEntries: {
          take: ADS_HYDRATION_LIMIT,
          orderBy: { startedAt: { sort: "desc", nulls: "last" } },
        },
      },
      take: CANDIDATE_BUSINESS_LIMIT,
    });

    const matched: string[] = [];
    for (const b of candidates) {
      const row: EvaluationRow = {
        id: b.id,
        business: b as unknown as Record<string, unknown>,
        snapshot: (b.snapshots[0] ?? null) as Record<string, unknown> | null,
        lighthouseAudit: (b.lighthouseAudits[0] ?? null) as Record<
          string,
          unknown
        > | null,
        reviews: b.reviews as unknown as ReadonlyArray<
          Record<string, unknown>
        >,
        serpResults: b.serpResults as unknown as ReadonlyArray<
          Record<string, unknown>
        >,
        adLibraryEntries: b.adLibraryEntries as unknown as ReadonlyArray<
          Record<string, unknown>
        >,
      };
      if (evaluateSpec(row, spec)) matched.push(b.id);
    }

    const matchedSet = new Set(matched);
    const existingLeads = await prisma.lead.findMany({
      where: { listId: list.id },
      select: { id: true, businessId: true, status: true },
    });

    const knownByBusiness = new Map(
      existingLeads.map((l) => [l.businessId, l]),
    );

    const toInsert = matched.filter((id) => !knownByBusiness.has(id));
    if (toInsert.length > 0) {
      await prisma.lead.createMany({
        data: toInsert.map((businessId) => ({
          listId: list.id,
          agencyId: list.agencyId,
          businessId,
          status: "NEW" as const,
        })),
        skipDuplicates: true,
      });
    }

    const toRemove = existingLeads
      .filter(
        (l) =>
          !matchedSet.has(l.businessId) && !TERMINAL_STATUSES.has(l.status),
      )
      .map((l) => l.id);
    let removed = 0;
    if (toRemove.length > 0) {
      const del = await prisma.lead.deleteMany({
        where: { id: { in: toRemove } },
      });
      removed = del.count;
    }

    const matchesBefore = existingLeads.length;
    const matchesAfter = matchesBefore + toInsert.length - removed;

    await prisma.listRefresh.create({
      data: {
        listId: list.id,
        matchesBefore,
        matchesAfter,
        added: toInsert.length,
        removed,
      },
    });

    await prisma.list.update({
      where: { id: list.id },
      data: { lastRefreshedAt: new Date() },
    });

    totalAdded += toInsert.length;
    totalRemoved += removed;
    totalMatched += matched.length;
    revalidatedLists.add(list.id);
    revalidatedAgencies.add(list.agencyId);
  });

  for (const id of revalidatedLists) {
    revalidateTag(`list-${id}`, "days");
    revalidateTag(`list-${id}-full`, "days");
  }
  for (const id of revalidatedAgencies) {
    revalidateTag(`agency-${id}`, "days");
    revalidateTag(`agency-${id}-analytics`, "days");
  }

  return {
    itemsProcessed: outcome.succeeded,
    status: statusFromOutcome(outcome),
    meta: {
      runId,
      listLimit,
      attempted: outcome.attempted,
      succeeded: outcome.succeeded,
      failed: outcome.failures.length,
      totalAdded,
      totalRemoved,
      totalMatched,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        listId: (f.item as ListRow).id,
        error: f.error,
      })),
    },
  };
});

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_LIST_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  CANDIDATE_BUSINESS_LIMIT,
  REVIEWS_HYDRATION_LIMIT,
  SERP_HYDRATION_LIMIT,
  ADS_HYDRATION_LIMIT,
  TERMINAL_STATUSES,
  clampLimitFromEnv,
};
