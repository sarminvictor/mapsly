"use server";

/**
 * /admin/cells · server actions.
 *
 * "Recompute references" rebuilds every CellMetric from the latest snapshots.
 * Mirrors the /admin/discovery action shape (requireAdminSession + Zod +
 * withCronRun) so the same useActionState + useActionToast pattern works, and
 * the run lands on a CronRun row visible at /admin/cron-runs (job
 * `admin:cells-aggregate` → "manual" category). Zero external-API cost — pure
 * Postgres aggregation — but wrapped in withCronRun for the audit trail.
 */

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import {
  runCellAggregation,
  type CellAggregationSummary,
} from "@/modules/market/cell-metrics";

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

export async function runCellAggregationAction(
  _prev: ActionResult<CellAggregationSummary> | null,
  _formData: FormData,
): Promise<ActionResult<CellAggregationSummary>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  let summary: CellAggregationSummary;
  try {
    summary = await withCronRun("admin:cells-aggregate", async () =>
      runCellAggregation(),
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }

  revalidatePath("/admin/cells");
  return {
    ok: true,
    data: summary,
    message: `Rebuilt ${summary.cellsWritten} cell reference(s) from ${summary.businessesScanned} businesses · ${summary.highConfidenceCells} high-confidence.`,
  };
}
