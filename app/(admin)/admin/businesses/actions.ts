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
import { qualifyBusiness } from "@/modules/business-qualification";

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
