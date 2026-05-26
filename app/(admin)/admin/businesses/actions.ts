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
  triggered: number;
  skipped: number;
  skipReasons: Record<string, number>;
  taskIdSample: string[];
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

  let result: BulkReviewPullActionResult;
  try {
    result = await withCronRun(
      "admin:reviews-trigger-bulk",
      async (): Promise<BulkReviewPullActionResult> => {
        let triggered = 0;
        let skipped = 0;
        const skipReasons: Record<string, number> = {};
        const taskIds: string[] = [];

        for (const businessId of parsed.data.businessIds) {
          try {
            const r = await triggerReviewPullForBusiness(businessId, {
              mode: "manual",
            });
            if (r.triggered) {
              triggered += 1;
              taskIds.push(r.taskId);
            } else {
              skipped += 1;
              skipReasons[r.reason] = (skipReasons[r.reason] ?? 0) + 1;
            }
          } catch (err) {
            skipped += 1;
            skipReasons["threw"] = (skipReasons["threw"] ?? 0) + 1;
            console.warn(
              `[admin:reviews-trigger-bulk] ${businessId} threw: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        return {
          triggered,
          skipped,
          skipReasons,
          taskIdSample: taskIds.slice(0, 5),
        };
      },
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
    message: `Triggered ${result.triggered}, skipped ${result.skipped}.`,
  };
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
