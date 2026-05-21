// Daily · list-refresh-daily
//
// DB-only handler: for each agency `List` with `refreshCadence='DAILY'`,
// re-evaluate the stored filter spec against the Business index and
// reconcile `Lead` rows:
//
//   - Newly-qualifying business → INSERT Lead with status=NEW
//   - Already-qualifying business → leave existing Lead alone (status preserved)
//   - De-qualifying business with an EDITABLE Lead status → DELETE Lead
//   - De-qualifying business with a TERMINAL Lead status (CONTACTED, REPLIED,
//     WON, LOST, HIDDEN) → leave Lead in place (agency has invested in it;
//     removing would lose context)
//
// One `ListRefresh` row per List records the delta for the analytics
// dashboard (F.5). No external API calls — runs entirely against Postgres.
//
// Cadence: daily 12:00 UTC per `vercel.json`.

import { revalidateTag } from "next/cache";
import prisma, { Prisma } from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import {
  evaluateSpec,
  type EvaluationRow,
  type FilterSpec,
} from "@/modules/hunter";
import { runBatch, statusFromOutcome } from "../_lib/batch";

const JOB = "daily:list-refresh-daily";
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;
const CANDIDATE_BUSINESS_LIMIT = 5_000;

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
    where: { isActive: true, refreshCadence: "DAILY" },
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
      // Malformed filter spec — record a refresh row with zero delta so the
      // analytics dashboard surfaces the issue + skip without throwing.
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

    // Candidate businesses — narrow by the list's targeting metadata first
    // (category + metro) so the evaluator runs over a bounded set.
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
        // Lead refresh only reads Business + Snapshot + Lighthouse signals
        // for the daily tier; weekly handler will hydrate Reviews / SerpResults
        // / AdLibraryEntries when those fuller signals matter.
        reviews: [],
        serpResults: [],
        adLibraryEntries: [],
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

    // Inserts — matched businesses with no Lead yet.
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

    // Removes — non-matched + non-terminal Leads only.
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
    revalidateTag(`list-${id}`, "hours");
  }
  for (const id of revalidatedAgencies) {
    revalidateTag(`agency-${id}`, "hours");
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

/**
 * Coerce a List.filterJson value into a FilterSpec. Returns null when the
 * JSON is missing / malformed — the handler treats this as a no-op refresh
 * rather than throwing, so a single broken list can't tank the whole batch.
 */
export function parseFilterSpec(raw: Prisma.JsonValue): FilterSpec | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const rows = Array.isArray(obj.rows) ? obj.rows : undefined;
  const exclusions = Array.isArray(obj.exclusions) ? obj.exclusions : undefined;
  const combineRaw = typeof obj.combine === "string" ? obj.combine : undefined;
  const combine =
    combineRaw === "and" || combineRaw === "or" ? combineRaw : undefined;

  if (!rows && !exclusions) return null;
  return {
    rows: rows as unknown as FilterSpec["rows"],
    exclusions: exclusions as unknown as FilterSpec["exclusions"],
    combine,
  };
}

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_DAILY_LIST_LIMIT;
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
  TERMINAL_STATUSES,
  parseFilterSpec,
  clampLimitFromEnv,
};
