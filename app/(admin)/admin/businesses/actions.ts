/**
 * /admin/businesses · server actions.
 *
 * Bulk + single-row operations · matches the existing /admin/discovery
 * action shape `(prevState, formData) => Promise<ActionResult<T>>` so
 * the same `useActionState` + `useActionToast` pattern works.
 *
 * Auth: admin gate enforced by the (admin) route group. Each action
 * double-checks session.user.role === "ADMIN" defense-in-depth.
 *
 * Cost discipline: every action that touches DataForSEO / OpenAI runs
 * inside withCronRun so the spend lands on a CronRun row.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { withCronRun } from "@/lib/cost/cost-counter";
import { triggerReviewPullForBusiness } from "@/modules/reviews/trigger-pull";
import { dispatchBulkReviewPull } from "@/modules/reviews/dispatch-bulk-pull";
import { dispatchSearchScan } from "@/modules/search-visibility/dispatch-bulk-scan";
import { dispatchAdsScan } from "@/modules/ads-intel/dispatch-ads-scan";
import { dispatchWebsiteScan } from "@/modules/website-intel/dispatch-website-scan";
import { qualifyBusiness } from "@/modules/business-qualification";
import {
  runPillarScoring,
  type PillarScoringSummary,
} from "@/modules/market/pillar-scoring";

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

async function requireAdminSession(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  if (session.user.role !== "ADMIN") {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    if (user?.role !== "ADMIN") throw new Error("forbidden");
  }
}

const SingleBizSchema = z.object({
  businessId: z.string().min(1).max(128),
});

const BulkBizSchema = z.object({
  businessIds: z.array(z.string().min(1).max(128)).min(1).max(500),
});

export interface TriggerReviewPullActionResult {
  taskId?: string;
  mode?: string;
  reason?: string;
}

export interface BulkReviewPullActionResult {
  /** Path the dispatcher took · "worker-enqueue" or "sequential-fallback". */
  strategy: "worker-enqueue" | "sequential-fallback";
  /** IDs the admin selected. */
  requested: number;
  /** Worker path: jobs the worker accepted. Sequential: triggered task_posts. */
  queuedOrTriggered: number;
  /** Worker path: jobs the worker rejected. Sequential: skipped + threw. */
  failedOrSkipped: number;
  /** Sequential path: per-reason skip histogram. */
  skipReasons?: Record<string, number>;
  /** Worker path: first 5 taskIds for log correlation. */
  taskIdSample?: string[];
}

export interface RerunQualifyActionResult {
  status: string;
  flags: string[];
  emailDiscovered: string | null;
  reviewPullTriggered: boolean;
}

/**
 * Trigger a manual review-pull for one business. Fires task_post against
 * DataForSEO Standard queue; the pingback handler upserts the result.
 */
export async function triggerReviewPullAction(
  _prev: ActionResult<TriggerReviewPullActionResult> | null,
  formData: FormData,
): Promise<ActionResult<TriggerReviewPullActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = SingleBizSchema.safeParse({
    businessId: formData.get("businessId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid request." };
  }

  let result;
  try {
    result = await withCronRun("admin:reviews-trigger", async () => {
      return triggerReviewPullForBusiness(parsed.data.businessId, {
        mode: "manual",
      });
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");

  if (result.triggered) {
    return {
      ok: true,
      data: { taskId: result.taskId, mode: result.mode },
      message: `Review pull triggered (task ${result.taskId.slice(0, 8)}…)`,
    };
  }
  return {
    ok: false,
    error: `Skipped: ${result.reason}`,
  };
}

/**
 * Bulk variant · fires task_posts for many businesses sequentially.
 * Sequential to keep DfS rate limits happy and to avoid one CronRun
 * ballooning past the function-timeout budget.
 */
export async function triggerReviewPullBulkAction(
  _prev: ActionResult<BulkReviewPullActionResult> | null,
  formData: FormData,
): Promise<ActionResult<BulkReviewPullActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const idsRaw = formData.get("businessIds");
  const ids =
    typeof idsRaw === "string" && idsRaw.length > 0 ? idsRaw.split(",") : [];
  const parsed = BulkBizSchema.safeParse({ businessIds: ids });
  if (!parsed.success) {
    return { ok: false, error: "Invalid selection." };
  }

  // Worker fan-out path · admin returns in <2s for 500 rows. Falls back
  // to sequential when BOXLY_WORKER_BASE_URL is unset (local dev).
  // Per Task #81 · prevents 60s server-action timeout at ~50 rows.
  let result: BulkReviewPullActionResult;
  try {
    result = await withCronRun("admin:reviews-trigger-bulk", async () =>
      dispatchBulkReviewPull({
        businessIds: parsed.data.businessIds,
        mode: "manual",
      }),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");

  // Wording depends on which path the dispatcher took.
  const message =
    result.strategy === "worker-enqueue"
      ? `Queued ${result.queuedOrTriggered}/${result.requested} on worker · ${result.failedOrSkipped} rejected · pingbacks land 1–45 min from now.`
      : `Triggered ${result.queuedOrTriggered}/${result.requested} sequentially · ${result.failedOrSkipped} skipped. (Worker not configured — using fallback.)`;

  return { ok: true, data: result, message };
}

/**
 * Re-run qualifyBusiness for one row. Idempotent · overwrites
 * qualificationStatus + flags + emailDiscovered.
 */
export async function rerunQualifyAction(
  _prev: ActionResult<RerunQualifyActionResult> | null,
  formData: FormData,
): Promise<ActionResult<RerunQualifyActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = SingleBizSchema.safeParse({
    businessId: formData.get("businessId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid request." };
  }

  let outcome;
  try {
    outcome = await withCronRun("admin:rerun-qualify", async () =>
      qualifyBusiness(parsed.data.businessId),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");

  return {
    ok: true,
    data: {
      status: outcome.status,
      flags: outcome.flags,
      emailDiscovered: outcome.emailDiscovered,
      reviewPullTriggered: outcome.reviewPull.triggered,
    },
    message: `Re-qualified · ${outcome.status}`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Search-visibility scans · S.1 plan v2 · admin-triggered (single + bulk)
// ────────────────────────────────────────────────────────────────────────

export interface SearchScanActionResult {
  /** Dispatcher strategy · "worker-enqueue" or "sequential-fallback". */
  strategy: "worker-enqueue" | "sequential-fallback";
  /** IDs the admin selected. */
  requested: number;
  /** Businesses that passed the paid-cell gate. */
  eligibleBusinesses: number;
  /** Worker: jobs enqueued · Sequential: per-biz discoveries completed. */
  queuedOrTriggered: number;
  /** Worker: rejected · Sequential: skipped/threw. */
  failedOrSkipped: number;
  /** Unique cells we'll run an aggregate Maps pass for. */
  cellsAggregated: number;
}

/**
 * Single-row · trigger ranked_keywords scan for ONE business (+ cell
 * aggregate if no other businesses in that cell · the dispatcher
 * always enqueues exactly 1 cell job per unique cell, no duplicate
 * Maps work).
 */
export async function triggerSearchScanAction(
  _prev: ActionResult<SearchScanActionResult> | null,
  formData: FormData,
): Promise<ActionResult<SearchScanActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = SingleBizSchema.safeParse({
    businessId: formData.get("businessId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid businessId." };
  }

  let result: SearchScanActionResult;
  try {
    result = await withCronRun("admin:search-scan", async () =>
      dispatchSearchScan({
        businessIds: [parsed.data.businessId],
        mode: "manual",
      }),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");
  return {
    ok: true,
    data: result,
    message:
      result.eligibleBusinesses === 0
        ? `Skipped · business not in a paid cell.`
        : result.strategy === "worker-enqueue"
          ? `Queued · ${result.queuedOrTriggered} worker job(s) · 1 cell aggregate · results land 1–3 min from now.`
          : `Ran sequentially · ${result.queuedOrTriggered} business scanned · ${result.cellsAggregated} cell aggregated.`,
  };
}

/**
 * Bulk · trigger ranked_keywords scans for N businesses. The dispatcher
 * groups by (city, country) cell and enqueues exactly ONE Maps-aggregate
 * job per unique cell · so a bulk on 25 businesses in Calgary fires 25
 * ranked_keywords + 1 Maps aggregate, NOT 25 Maps aggregates. This is
 * the optimization Viktor asked for.
 */
export async function triggerSearchScanBulkAction(
  _prev: ActionResult<SearchScanActionResult> | null,
  formData: FormData,
): Promise<ActionResult<SearchScanActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const idsRaw = formData.get("businessIds");
  const ids =
    typeof idsRaw === "string" && idsRaw.length > 0 ? idsRaw.split(",") : [];
  const parsed = BulkBizSchema.safeParse({ businessIds: ids });
  if (!parsed.success) {
    return { ok: false, error: "Invalid selection." };
  }

  let result: SearchScanActionResult;
  try {
    result = await withCronRun("admin:search-scan-bulk", async () =>
      dispatchSearchScan({
        businessIds: parsed.data.businessIds,
        mode: "bulk",
      }),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");

  const message =
    result.eligibleBusinesses === 0
      ? `Skipped all · 0 in paid cells of ${result.requested} selected.`
      : result.strategy === "worker-enqueue"
        ? `Queued ${result.queuedOrTriggered} worker jobs · ${result.cellsAggregated} cell aggregate(s) for ${result.eligibleBusinesses}/${result.requested} eligible businesses.`
        : `Ran ${result.queuedOrTriggered}/${result.eligibleBusinesses} sequentially · ${result.cellsAggregated} cells aggregated.`;

  return { ok: true, data: result, message };
}

// ────────────────────────────────────────────────────────────────────────
// Ads-intelligence scans · /ads page · admin-triggered (single + bulk)
//
// "Run Ads" dispatches like reviews + searches: a Boxly Worker job per
// business for the fast DataForSEO/Google pass (keyword costs + Transparency),
// returning instantly. Meta (Apify ~2-3 min) exceeds the worker's 120s per-job
// cap, so it refreshes on the weekly ads-meta cron. When the worker env is
// unset (local dev) the dispatcher falls back to the prior inline behavior
// (DFS/Google + up to one Meta cell).
// ────────────────────────────────────────────────────────────────────────

export interface AdsScanActionResult {
  businesses: number;
  keywordsUpserted: number;
  errors: number;
}

/** Single-row · run the FULL ads pass (DataForSEO + Meta) for ONE business. */
export async function triggerAdsScanAction(
  _prev: ActionResult<AdsScanActionResult> | null,
  formData: FormData,
): Promise<ActionResult<AdsScanActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = SingleBizSchema.safeParse({
    businessId: formData.get("businessId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid businessId." };
  }

  // Dispatch like reviews + searches: enqueue a Boxly Worker job for the fast
  // DataForSEO/Google pass (returns instantly), or run inline when the worker
  // is unset (local dev). Meta refreshes on the weekly ads-meta cron.
  let result;
  try {
    result = await withCronRun("admin:ads-scan", async () =>
      dispatchAdsScan({
        businessIds: [parsed.data.businessId],
        mode: "manual",
      }),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");
  return {
    ok: true,
    data: {
      businesses: result.requested,
      keywordsUpserted: result.keywordsUpserted ?? 0,
      errors: result.failedOrSkipped,
    },
    message:
      result.strategy === "worker-enqueue"
        ? `Queued · ${result.queuedOrTriggered} worker job · keyword costs + Google ads land in ~1-2 min. Meta refreshes on the weekly cron.`
        : `Ads scan ran · ${result.keywordsUpserted ?? 0} keyword costs · ${
            result.metaAds ?? 0
          } Meta advertiser(s).`,
  };
}

/**
 * Bulk · enqueue one worker job per business for the DataForSEO/Google pass
 * (concurrency + retries on the worker, no inline cap). Meta market cells
 * refresh on the weekly ads-meta cron (cell-deduped). Sequential fallback runs
 * inline when the worker env is unset.
 */
export async function triggerAdsScanBulkAction(
  _prev: ActionResult<AdsScanActionResult> | null,
  formData: FormData,
): Promise<ActionResult<AdsScanActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const idsRaw = formData.get("businessIds");
  const ids =
    typeof idsRaw === "string" && idsRaw.length > 0 ? idsRaw.split(",") : [];
  const parsed = BulkBizSchema.safeParse({ businessIds: ids });
  if (!parsed.success) {
    return { ok: false, error: "Invalid selection." };
  }

  // Enqueue one worker job per business for the DataForSEO/Google pass — the
  // worker runs them with concurrency + retries, so no inline cap is needed.
  // Meta market cells refresh on the weekly ads-meta cron. Sequential fallback
  // (worker unset) runs them inline like before.
  let result;
  try {
    result = await withCronRun("admin:ads-scan-bulk", async () =>
      dispatchAdsScan({ businessIds: parsed.data.businessIds, mode: "bulk" }),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");
  return {
    ok: true,
    data: {
      businesses: result.requested,
      keywordsUpserted: result.keywordsUpserted ?? 0,
      errors: result.failedOrSkipped,
    },
    message:
      result.strategy === "worker-enqueue"
        ? `Queued · ${result.queuedOrTriggered} worker job(s) for ${result.requested} business(es) · keyword costs + Google ads land shortly. Meta refreshes on the weekly cron.`
        : `Ads scan ran inline · ${result.keywordsUpserted ?? 0} keyword costs · ${
            result.metaAds ?? 0
          } Meta advertiser(s).`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Website scan · runs the SAME `collectWebsiteForBatch` the weekly
// lighthouse-audit cron uses — Lighthouse (speed + Core Web Vitals) + our DOM
// checks (schema, NAP, booking CTA, phone-above-fold) → a LighthouseAudit row
// per business → revalidates the owner's `/website` cache. One shared
// collector means a manual run == a cron run. Lighthouse is the most
// expensive single API + runs sequentially, so bulk is capped at 5 inline;
// the rest refresh on the weekly cron.
// ────────────────────────────────────────────────────────────────────────

export interface WebsiteScanActionResult {
  businesses: number;
  audited: number;
  errors: number;
}

/** Single-row · run the full website audit for ONE business. */
export async function triggerWebsiteScanAction(
  _prev: ActionResult<WebsiteScanActionResult> | null,
  formData: FormData,
): Promise<ActionResult<WebsiteScanActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = SingleBizSchema.safeParse({
    businessId: formData.get("businessId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid businessId." };
  }

  // Dispatch like reviews + searches: enqueue a Boxly Worker job (returns
  // instantly) or run inline when the worker is unset (local dev).
  let result;
  try {
    result = await withCronRun("admin:website-scan", async () =>
      dispatchWebsiteScan({
        businessIds: [parsed.data.businessId],
        mode: "manual",
      }),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");
  return {
    ok: true,
    data: {
      businesses: result.requested,
      audited: result.queuedOrTriggered,
      errors: result.failedOrSkipped,
    },
    message:
      result.eligibleBusinesses === 0
        ? "Skipped · no website on record."
        : result.strategy === "worker-enqueue"
          ? `Queued · ${result.queuedOrTriggered} worker job · Lighthouse result lands in ~1 min.`
          : `Website audit ran · ${result.queuedOrTriggered} audited${
              result.failedOrSkipped
                ? ` · ${result.failedOrSkipped} error(s)`
                : ""
            }.`,
  };
}

/**
 * Bulk · audit N businesses' websites. Lighthouse runs sequentially and is the
 * priciest single API, so we cap at 5 inline (fits the 300s function budget);
 * overflow refreshes on the weekly lighthouse-audit cron.
 */
export async function triggerWebsiteScanBulkAction(
  _prev: ActionResult<WebsiteScanActionResult> | null,
  formData: FormData,
): Promise<ActionResult<WebsiteScanActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const idsRaw = formData.get("businessIds");
  const ids =
    typeof idsRaw === "string" && idsRaw.length > 0 ? idsRaw.split(",") : [];
  const parsed = BulkBizSchema.safeParse({ businessIds: ids });
  if (!parsed.success) {
    return { ok: false, error: "Invalid selection." };
  }

  // One worker job per business with a website — concurrency + retries on the
  // worker, no inline cap. Sequential fallback (worker unset) runs inline.
  let result;
  try {
    result = await withCronRun("admin:website-scan-bulk", async () =>
      dispatchWebsiteScan({
        businessIds: parsed.data.businessIds,
        mode: "bulk",
      }),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");
  return {
    ok: true,
    data: {
      businesses: result.requested,
      audited: result.queuedOrTriggered,
      errors: result.failedOrSkipped,
    },
    message:
      result.eligibleBusinesses === 0
        ? "Skipped · none of the selected businesses have a website."
        : result.strategy === "worker-enqueue"
          ? `Queued · ${result.queuedOrTriggered} worker job(s) for ${result.eligibleBusinesses} site(s) · Lighthouse results land shortly.`
          : `Website audit ran inline · ${result.queuedOrTriggered} of ${result.eligibleBusinesses} audited.`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Scoring v2 · recompute pillar scores + MSI for the index. Grades each
// business against its CellMetric and revives msiRank / msiTotal. No external
// API — pure compute over snapshots + cell references. Run "Recompute
// references" on /admin/cells first so scores grade against fresh medians.
// ────────────────────────────────────────────────────────────────────────

export async function recomputeScoresAction(
  _prev: ActionResult<PillarScoringSummary> | null,
  _formData: FormData,
): Promise<ActionResult<PillarScoringSummary>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  let summary: PillarScoringSummary;
  try {
    summary = await withCronRun("admin:scores-recompute", async () =>
      runPillarScoring(),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/businesses");
  return {
    ok: true,
    data: summary,
    message: `Recomputed pillars + MSI for ${summary.businessesScored} business(es) across ${summary.metrosRanked} metro(s) · ${summary.withCellRef} graded vs cell.`,
  };
}
