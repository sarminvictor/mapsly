// modules/enrichment/dispatch.ts · the enrichment dispatcher (Phase 3 glue).
//
// The user-facing actions only ENQUEUE work (a PENDING Discovery or a PENDING
// EnrichmentRun row) — never call an external API in the request path
// (`.claude/rules/cost-discipline.md`). This module is the air-gapped consumer:
// the internal cron route (`/api/cron/internal/dispatch`) calls dispatchPending
// inside a withCronRun, and we drive each PENDING row through the real worker
// functions (discovery maps-search, contact scan, reviews, cell ads/serp, AI
// research, services, playbooks).
//
// Failure isolation (`.claude/rules/scalability.md`): one business or cell that
// throws never aborts the run — it's counted as failed, the rest proceed, and
// the run closes PARTIAL. A run with zero failures closes OK.

import prisma from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import type { EnrichmentType } from "@/modules/cost/pricing";
import { reconcileRunCredits } from "@/modules/cost/server";
import { usdToCredits } from "@/modules/cost/estimate";
import { runDiscovery } from "@/modules/discovery/run-discovery";
import { scanBusinessContacts } from "@/modules/contacts/scan";
import { submitReviewJob } from "@/modules/reviews/review-job";
import { runMetaAdsForCell } from "@/modules/cell-intel/meta-ads";
import { runGoogleAdsForCell } from "@/modules/cell-intel/google-ads";
import { runSerpForCell } from "@/modules/cell-intel/serp";
import { runPlaybooksForBusiness } from "@/modules/playbooks/run";
import { runAiResearchForBusiness } from "@/modules/ai-research/pipeline";
import { extractServicesForBusiness } from "@/modules/services-general/extract";

export interface DispatchResult {
  discoveriesRun: number;
  discoveriesFailed: number;
  enrichmentRunsProcessed: number;
  unitsDone: number;
  unitsFailed: number;
}

interface ScopeRefs {
  businessIds?: string[];
  cellKeys?: string[];
}

function logErr(ctx: string, key: string, err: unknown): void {
  console.error(
    JSON.stringify({
      level: "error",
      event: "dispatch.unit.error",
      ctx,
      key,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/**
 * Execute one PENDING EnrichmentRun: route each requested family over the run's
 * business/cell scope, then close OK (no failures) or PARTIAL (≥1 failure).
 * Exported for unit testing.
 */
export async function processEnrichmentRun(
  runId: string,
): Promise<{ done: number; failed: number }> {
  const run = await prisma.enrichmentRun.findUnique({
    where: { id: runId },
    select: { id: true, enrichmentsJson: true, scopeRefsJson: true },
  });
  if (!run) return { done: 0, failed: 0 };

  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: { status: "RUNNING" },
  });

  const families = (
    Array.isArray(run.enrichmentsJson) ? run.enrichmentsJson : []
  ) as EnrichmentType[];
  const has = (f: EnrichmentType) => families.includes(f);
  const scope = (run.scopeRefsJson ?? {}) as ScopeRefs;
  const businessIds = scope.businessIds ?? [];
  const cellKeys = scope.cellKeys ?? [];

  let done = 0;
  let failed = 0;
  const tally = async (
    label: string,
    key: string,
    fn: () => Promise<unknown>,
  ) => {
    try {
      await fn();
      done++;
    } catch (err) {
      failed++;
      logErr(label, key, err);
    }
  };

  // ── Per-business families ──
  // contacts + tech share one scan pass (scanBusinessContacts fingerprints tech).
  const needsScan = has("contacts") || has("tech");
  const touchedBusiness =
    needsScan || has("services") || has("reviews") || has("ai_research");
  for (const id of businessIds) {
    if (needsScan) await tally("contacts", id, () => scanBusinessContacts(id));
    if (has("services"))
      await tally("services", id, () => extractServicesForBusiness(id));
    if (has("reviews"))
      await tally("reviews", id, () => submitReviewJob(id, "manual"));
    if (has("ai_research"))
      await tally("ai_research", id, () => runAiResearchForBusiness(id));
    // Expert layer auto-runs once fresh per-business data may exist ($0,
    // deterministic). Best-effort: a playbook miss never fails the unit.
    if (touchedBusiness) {
      try {
        await runPlaybooksForBusiness(id);
      } catch (err) {
        logErr("playbooks", id, err);
      }
    }
  }

  // ── Per-cell families ──
  for (const k of cellKeys) {
    if (has("meta_ads")) await tally("meta_ads", k, () => runMetaAdsForCell(k));
    if (has("google_ads"))
      await tally("google_ads", k, () => runGoogleAdsForCell(k));
    if (has("serp")) await tally("serp", k, () => runSerpForCell(k));
  }

  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: {
      status: failed > 0 ? "PARTIAL" : "OK",
      unitsCompleted: done,
      finishedAt: new Date(),
    },
  });

  // Settle the credit hold: charge the quoted credits if any unit completed,
  // else refund the entire hold. Per-job actuals land with the job rail.
  await reconcileRunCredits(runId, { hadProgress: done > 0 });

  return { done, failed };
}

/**
 * Execute one PENDING Discovery: reconstruct the cell requests from cellKeys
 * (resolving categoryId from BusinessCategory.dataforseoId) and hand off to
 * runDiscovery, which upserts the SAME row by idempotency key. Returns true on
 * success. Exported for unit testing.
 */
export async function processDiscovery(discoveryId: string): Promise<boolean> {
  const d = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: {
      id: true,
      agencyId: true,
      requestedByUserId: true,
      cellKeys: true,
    },
  });
  if (!d) return false;

  try {
    const cells: {
      categorySlug: string;
      categoryId: string;
      metroSlug: string;
      country: string;
    }[] = [];
    for (const ck of d.cellKeys) {
      const p = parseCellKey(ck);
      if (!p) continue;
      const cat = await prisma.businessCategory.findFirst({
        where: { dataforseoId: p.categorySlug },
        select: { id: true },
      });
      if (!cat) continue;
      cells.push({
        categorySlug: p.categorySlug,
        categoryId: cat.id,
        metroSlug: p.metroSlug,
        country: p.country,
      });
    }

    if (cells.length === 0) {
      await prisma.discovery.update({
        where: { id: d.id },
        data: { status: "FAILED" },
      });
      await reconcileRunCredits(d.id, { hadProgress: false });
      return false;
    }

    await runDiscovery({
      agencyId: d.agencyId,
      userId: d.requestedByUserId,
      cells,
    });

    // Settle against the actual DfS fetch cost — fresh cells served from the DB
    // refund to $0 (the execution-side no-double-spend guard).
    const after = await prisma.discovery.findUnique({
      where: { id: d.id },
      select: { totalCostUsd: true },
    });
    await reconcileRunCredits(d.id, {
      actualCredits: usdToCredits(after?.totalCostUsd ?? 0),
      hadProgress: true,
    });
    return true;
  } catch (err) {
    logErr("discovery", discoveryId, err);
    await prisma.discovery
      .update({ where: { id: d.id }, data: { status: "FAILED" } })
      .catch(() => {});
    await reconcileRunCredits(d.id, { hadProgress: false });
    return false;
  }
}

/**
 * Drain up to `limit` PENDING discoveries + `limit` PENDING enrichment runs.
 * Discoveries run first (they produce the businesses enrichments need). Called
 * by the internal dispatch cron inside a withCronRun (so external calls are
 * cost-attributed + never in a user request path).
 */
export async function dispatchPending(limit = 10): Promise<DispatchResult> {
  const res: DispatchResult = {
    discoveriesRun: 0,
    discoveriesFailed: 0,
    enrichmentRunsProcessed: 0,
    unitsDone: 0,
    unitsFailed: 0,
  };

  const pendingDiscoveries = await prisma.discovery.findMany({
    where: { status: "PENDING" },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  for (const d of pendingDiscoveries) {
    if (await processDiscovery(d.id)) res.discoveriesRun++;
    else res.discoveriesFailed++;
  }

  const pendingRuns = await prisma.enrichmentRun.findMany({
    where: { status: "PENDING" },
    select: { id: true },
    take: limit,
    orderBy: { startedAt: "asc" },
  });
  for (const r of pendingRuns) {
    const { done, failed } = await processEnrichmentRun(r.id);
    res.enrichmentRunsProcessed++;
    res.unitsDone += done;
    res.unitsFailed += failed;
  }

  return res;
}
