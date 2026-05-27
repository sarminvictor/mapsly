/**
 * /admin/cron-runs · queries.
 *
 * Operational telemetry for every cron + admin-triggered job.
 * Surfaces:
 *   - Job categorization by trigger source (scheduled / manual / worker /
 *     pingback / internal) · jobs sharing a category share an
 *     operational concern
 *   - Per-job aggregate (last-7d, total runs, total cost, status mix)
 *   - Recent runs list with category badge + status pills + drilldown
 *   - Per-run detail (meta JSON, itemsProcessed, cost, error message)
 *   - **Trigger chain** · for a selected run, surfaces correlated
 *     downstream runs (the things this run fired off) using
 *     time-window + businessId-in-meta heuristics
 */

import prisma from "@/lib/prisma";

// ============================================================================
// CATEGORIES · trigger source taxonomy
// ============================================================================

export type CronRunCategory =
  | "scheduled" // Vercel cron · daily:* / weekly:* / monthly:*
  | "manual" // Admin / user click · admin:* / manual:*
  | "worker" // Boxly Worker callback · worker:*
  | "pingback" // External API ping · *:pingback-handler
  | "internal" // Process-enhancer, audit, etc.
  | "other"; // Catch-all

export interface CategoryMeta {
  key: CronRunCategory;
  label: string;
  /** One-line explainer shown under the tab. */
  description: string;
  /** Emoji indicator for the badge · keeps the table compact. */
  icon: string;
}

export const CATEGORY_META: Record<CronRunCategory, CategoryMeta> = {
  scheduled: {
    key: "scheduled",
    label: "Scheduled",
    description: "Vercel cron jobs · daily / weekly / monthly schedule",
    icon: "⏱",
  },
  manual: {
    key: "manual",
    label: "Manual",
    description: "Triggered by admin click or user action",
    icon: "👤",
  },
  worker: {
    key: "worker",
    label: "Worker",
    description: "Boxly Worker callbacks · per-business fan-out",
    icon: "⚙",
  },
  pingback: {
    key: "pingback",
    label: "Pingbacks",
    description: "Inbound webhooks from external APIs (DataForSEO etc.)",
    icon: "📡",
  },
  internal: {
    key: "internal",
    label: "Internal",
    description: "Process-enhancer, audits, self-improvement jobs",
    icon: "🔧",
  },
  other: {
    key: "other",
    label: "Other",
    description: "Anything that doesn't match the above prefixes",
    icon: "—",
  },
};

/** Heuristic · maps a job-name prefix to its trigger source category. */
export function categorizeJob(job: string): CronRunCategory {
  if (
    job.startsWith("daily:") ||
    job.startsWith("weekly:") ||
    job.startsWith("monthly:")
  ) {
    return "scheduled";
  }
  if (job.startsWith("admin:") || job.startsWith("manual:")) {
    return "manual";
  }
  if (job.startsWith("worker:")) {
    return "worker";
  }
  if (job.endsWith(":pingback-handler") || job.endsWith(":pingback")) {
    return "pingback";
  }
  if (
    job === "process-enhancer" ||
    job.startsWith("internal:") ||
    job.startsWith("system:") ||
    job.startsWith("audit:")
  ) {
    return "internal";
  }
  return "other";
}

// ============================================================================
// AGGREGATE TYPES
// ============================================================================

export interface JobAggregate {
  job: string;
  category: CronRunCategory;
  totalRuns: number;
  okCount: number;
  failedCount: number;
  partialCount: number;
  runningCount: number;
  totalCostUsd: number;
  lastRunAt: Date | null;
}

export interface CategoryAggregate {
  category: CronRunCategory;
  totalRuns: number;
  okCount: number;
  failedCount: number;
  partialCount: number;
  runningCount: number;
  totalCostUsd: number;
  /** Per-job breakdown within this category, lastRun-desc sorted. */
  jobs: JobAggregate[];
}

export interface CronRunRow {
  id: string;
  job: string;
  category: CronRunCategory;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  itemsProcessed: number;
  costUsd: number | null;
  errorMessage: string | null;
  durationSec: number | null;
}

export interface CronRunListFilters {
  job?: string;
  category?: CronRunCategory | "ALL";
  status?: "OK" | "PARTIAL" | "FAILED" | "RUNNING" | "ALL";
  sinceDays?: number;
  limit?: number;
}

export interface CronRunListResult {
  rows: CronRunRow[];
  total: number;
  /** Per-category aggregates · always all 6 even if empty (stable layout). */
  categories: CategoryAggregate[];
  /** Distinct job names for the filter dropdown · category-aware. */
  jobNames: string[];
}

// ============================================================================
// LIST + AGGREGATE QUERY
// ============================================================================

export async function getCronRunsView(
  filters: CronRunListFilters = {},
): Promise<CronRunListResult> {
  const limit = Math.min(filters.limit ?? 100, 500);
  const sinceDays = filters.sinceDays ?? 7;
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  // Build the WHERE clause for the row + total query (category filter
  // applies post-DB via the prefix predicate since the column doesn't
  // exist · most rows fit in memory after the time + status pre-filter).
  const where: Record<string, unknown> = { startedAt: { gte: since } };
  if (filters.job && filters.job !== "ALL") where.job = filters.job;
  if (filters.status && filters.status !== "ALL") where.status = filters.status;

  const [rawRows, perJob, jobNames] = await Promise.all([
    prisma.cronRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      // Over-fetch · we may filter by category in memory · cap to a sane max.
      take: Math.min(limit * 3, 500),
      select: {
        id: true,
        job: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        itemsProcessed: true,
        costUsd: true,
        errorMessage: true,
      },
    }),
    prisma.cronRun.groupBy({
      by: ["job", "status"],
      where: { startedAt: { gte: since } },
      _count: { id: true },
      _sum: { costUsd: true },
      _max: { startedAt: true },
    }),
    prisma.cronRun.findMany({
      select: { job: true },
      distinct: ["job"],
      orderBy: { job: "asc" },
      take: 100,
    }),
  ]);

  // Build per-job aggregate.
  const byJob = new Map<string, JobAggregate>();
  for (const g of perJob) {
    const agg = byJob.get(g.job) ?? {
      job: g.job,
      category: categorizeJob(g.job),
      totalRuns: 0,
      okCount: 0,
      failedCount: 0,
      partialCount: 0,
      runningCount: 0,
      totalCostUsd: 0,
      lastRunAt: null as Date | null,
    };
    agg.totalRuns += g._count.id;
    agg.totalCostUsd += g._sum.costUsd ?? 0;
    if (
      g._max.startedAt &&
      (!agg.lastRunAt || g._max.startedAt > agg.lastRunAt)
    ) {
      agg.lastRunAt = g._max.startedAt;
    }
    switch (g.status) {
      case "OK":
        agg.okCount += g._count.id;
        break;
      case "FAILED":
        agg.failedCount += g._count.id;
        break;
      case "PARTIAL":
        agg.partialCount += g._count.id;
        break;
      case "RUNNING":
        agg.runningCount += g._count.id;
        break;
    }
    byJob.set(g.job, agg);
  }

  // Group jobs into categories.
  const categoryMap = new Map<CronRunCategory, CategoryAggregate>();
  for (const cat of Object.keys(CATEGORY_META) as CronRunCategory[]) {
    categoryMap.set(cat, {
      category: cat,
      totalRuns: 0,
      okCount: 0,
      failedCount: 0,
      partialCount: 0,
      runningCount: 0,
      totalCostUsd: 0,
      jobs: [],
    });
  }
  for (const jobAgg of byJob.values()) {
    const cat = categoryMap.get(jobAgg.category)!;
    cat.totalRuns += jobAgg.totalRuns;
    cat.okCount += jobAgg.okCount;
    cat.failedCount += jobAgg.failedCount;
    cat.partialCount += jobAgg.partialCount;
    cat.runningCount += jobAgg.runningCount;
    cat.totalCostUsd += jobAgg.totalCostUsd;
    cat.jobs.push(jobAgg);
  }
  for (const cat of categoryMap.values()) {
    cat.jobs.sort(
      (a, b) => (b.lastRunAt?.getTime() ?? 0) - (a.lastRunAt?.getTime() ?? 0),
    );
  }

  // Apply category filter to rows + tag each row with its category.
  const wantCategory =
    filters.category && filters.category !== "ALL" ? filters.category : null;
  const filteredRows = wantCategory
    ? rawRows.filter((r) => categorizeJob(r.job) === wantCategory)
    : rawRows;

  // Slice to the requested limit AFTER category filtering.
  const rows = filteredRows.slice(0, limit).map((r) => ({
    id: r.id,
    job: r.job,
    category: categorizeJob(r.job),
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    status: r.status,
    itemsProcessed: r.itemsProcessed,
    costUsd: r.costUsd,
    errorMessage: r.errorMessage,
    durationSec:
      r.finishedAt && r.startedAt
        ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)
        : null,
  }));

  return {
    rows,
    total: filteredRows.length,
    categories: Array.from(categoryMap.values()).filter((c) => c.totalRuns > 0),
    jobNames: jobNames.map((j) => j.job),
  };
}

// ============================================================================
// DETAIL + TRIGGER CHAIN
// ============================================================================

export interface CronRunDetail {
  id: string;
  job: string;
  category: CronRunCategory;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  itemsProcessed: number;
  costUsd: number | null;
  errorMessage: string | null;
  durationSec: number | null;
  meta: unknown;
}

export interface TriggeredRun {
  id: string;
  job: string;
  category: CronRunCategory;
  startedAt: string;
  status: string;
  costUsd: number | null;
  itemsProcessed: number;
  errorMessage: string | null;
  /** Seconds between the parent's start and this run's start. */
  offsetSec: number;
  /** Best-guess businessId extracted from meta (if present). */
  businessId: string | null;
}

export interface TriggerChain {
  /** Runs that fired AFTER this one (heuristic correlation). */
  children: TriggeredRun[];
  /** Total cost across the children (excluding the parent). */
  childrenTotalCostUsd: number;
}

/**
 * Known parent → child relationships in our system. Used to constrain
 * the heuristic correlation so we don't surface unrelated runs that
 * happened to overlap in time.
 */
const TRIGGER_RULES: Array<{
  parentJob: string | RegExp;
  childJob: string | RegExp;
  /** Max seconds between parent.startedAt and child.startedAt. */
  windowSec: number;
}> = [
  // Scheduled bulk → worker fan-out
  {
    parentJob: "weekly:reviews-delta",
    childJob: "worker:reviews-trigger",
    windowSec: 60,
  },
  {
    parentJob: "admin:reviews-trigger-bulk",
    childJob: "worker:reviews-trigger",
    windowSec: 60,
  },

  // Admin qualify (single or bulk) → worker fan-out
  {
    parentJob: /^admin:qualify/,
    childJob: "admin:qualify-one",
    windowSec: 600,
  },

  // Admin qualify-one → DfS task_post → pingback (via pendingReviewsTaskId)
  {
    parentJob: "admin:qualify-one",
    childJob: "reviews:pingback-handler",
    windowSec: 2700,
  },

  // Worker reviews-trigger → DfS task_post → pingback
  {
    parentJob: "worker:reviews-trigger",
    childJob: "reviews:pingback-handler",
    windowSec: 2700,
  },

  // Manual regenerate-reply → no children (in-process AI call)

  // Discovery bulk → worker → qualify-one (covered above)

  // Weekly business-profile-refresh → snapshot-write (sequential weekly jobs)
  {
    parentJob: "weekly:business-profile-refresh",
    childJob: "weekly:snapshot-write",
    windowSec: 600,
  },
];

export async function getCronRunDetail(
  id: string,
): Promise<CronRunDetail | null> {
  const row = await prisma.cronRun.findUnique({ where: { id } });
  if (!row) return null;
  return {
    id: row.id,
    job: row.job,
    category: categorizeJob(row.job),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status,
    itemsProcessed: row.itemsProcessed,
    costUsd: row.costUsd,
    errorMessage: row.errorMessage,
    durationSec:
      row.finishedAt && row.startedAt
        ? Math.round(
            (row.finishedAt.getTime() - row.startedAt.getTime()) / 1000,
          )
        : null,
    meta: row.meta,
  };
}

/**
 * Find runs that this run likely triggered. Heuristic correlation by:
 *   1. Known parent→child rule (one of TRIGGER_RULES)
 *   2. Time-window match (child.startedAt within [parent.startedAt,
 *      parent.startedAt + windowSec])
 *   3. Optional businessId match · if the parent's meta or job name
 *      references a businessId, prefer children that also reference it
 *
 * NOT a true causal link — for that we'd need a `parentRunId` column on
 * CronRun. Until then this is honest "things that probably happened
 * because of this run."
 */
export async function getTriggerChain(parentId: string): Promise<TriggerChain> {
  const parent = await prisma.cronRun.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      job: true,
      startedAt: true,
      meta: true,
    },
  });
  if (!parent) return { children: [], childrenTotalCostUsd: 0 };

  // Find matching rules for this parent.
  const matchingRules = TRIGGER_RULES.filter((r) =>
    matchJob(r.parentJob, parent.job),
  );
  if (matchingRules.length === 0) {
    return { children: [], childrenTotalCostUsd: 0 };
  }

  // For each rule, compute its time window and look up candidates.
  const maxWindow = Math.max(...matchingRules.map((r) => r.windowSec));
  const upper = new Date(parent.startedAt.getTime() + maxWindow * 1000);

  const candidates = await prisma.cronRun.findMany({
    where: {
      id: { not: parent.id },
      startedAt: {
        gte: parent.startedAt,
        lte: upper,
      },
    },
    orderBy: { startedAt: "asc" },
    take: 500,
    select: {
      id: true,
      job: true,
      startedAt: true,
      status: true,
      costUsd: true,
      itemsProcessed: true,
      errorMessage: true,
      meta: true,
    },
  });

  // Filter candidates to those matching a rule + the rule's window.
  const parentBizId = extractBusinessId(parent.meta);
  const children: TriggeredRun[] = [];
  for (const c of candidates) {
    const rule = matchingRules.find(
      (r) =>
        matchJob(r.childJob, c.job) &&
        c.startedAt.getTime() - parent.startedAt.getTime() <=
          r.windowSec * 1000,
    );
    if (!rule) continue;

    // BusinessId filter · only relevant for worker→pingback path.
    // If the parent has a businessId AND the child has one, they must match.
    const childBizId = extractBusinessId(c.meta);
    if (parentBizId && childBizId && parentBizId !== childBizId) continue;

    children.push({
      id: c.id,
      job: c.job,
      category: categorizeJob(c.job),
      startedAt: c.startedAt.toISOString(),
      status: c.status,
      costUsd: c.costUsd,
      itemsProcessed: c.itemsProcessed,
      errorMessage: c.errorMessage,
      offsetSec: Math.round(
        (c.startedAt.getTime() - parent.startedAt.getTime()) / 1000,
      ),
      businessId: childBizId,
    });
  }

  const childrenTotalCostUsd = children.reduce(
    (sum, c) => sum + (c.costUsd ?? 0),
    0,
  );

  return { children, childrenTotalCostUsd };
}

function matchJob(matcher: string | RegExp, job: string): boolean {
  if (typeof matcher === "string") return job === matcher;
  return matcher.test(job);
}

/**
 * Best-effort businessId extractor from CronRun.meta. Recognises a few
 * conventions used across our codebase:
 *   - meta.businessId  (worker:reviews-trigger, admin:qualify-one)
 *   - meta.taskIdSample[0] (bulk actions · we use it to correlate via
 *     the embedded business id)
 *   - tag-style `mapsly:<mode>:biz_<id>` strings (legacy)
 */
function extractBusinessId(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  if (typeof m.businessId === "string") return m.businessId;
  if (Array.isArray(m.taskIdSample) && m.taskIdSample.length > 0) {
    // taskIdSample format: "mapsly-reviews-trigger-<businessId>-<ts>"
    const first = m.taskIdSample[0];
    if (typeof first === "string") {
      const match = first.match(/-([a-z0-9]{20,})-\d+$/i);
      if (match) return match[1] ?? null;
    }
  }
  return null;
}
