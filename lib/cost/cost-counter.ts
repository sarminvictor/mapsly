// Cost counter · AsyncLocalStorage-bound CronRun lifecycle.
//
// Purpose: every external API call is attributable to an open CronRun row.
// The CronRun.costUsd column accumulates spend; CronRun.itemsProcessed tracks
// throughput. Adapters under services/* wrap their network call with
// `withCostCounter` which:
//
//   1. Reads the current CronRun from AsyncLocalStorage.
//   2. Throws if no CronRun is open — this is the "no live API in user request
//      path" enforcement per .claude/rules/cost-discipline.md.
//   3. Executes the wrapped fn.
//   4. Atomically increments CronRun.costUsd by the unit cost.
//
// Cron handlers open a CronRun via `withCronRun(jobName, fn)` (or manually via
// openCronRun/closeCronRun for advanced flow control). User-facing routes
// never open a CronRun, so any cost-counted adapter call from a user route
// throws — exactly the invariant we want.

import { AsyncLocalStorage } from "node:async_hooks";
import prisma from "@/lib/prisma";

export type CronRunStatus = "OK" | "PARTIAL" | "FAILED";

export interface CronRunHandle {
  id: string;
  job: string;
  startedAt: Date;
}

interface CronRunContext {
  run: CronRunHandle;
}

const storage = new AsyncLocalStorage<CronRunContext>();

/** Returns the open CronRun for the current async frame, or null. */
export function getCurrentCronRun(): CronRunHandle | null {
  return storage.getStore()?.run ?? null;
}

/**
 * Throws a descriptive error if there is no open CronRun in the current
 * async frame. Used by `withCostCounter` and by anything that must not be
 * called from a user request path.
 */
export function assertCronContext(operation: string): CronRunHandle {
  const run = getCurrentCronRun();
  if (!run) {
    throw new Error(
      `[cost-counter] "${operation}" called outside of an open CronRun. ` +
        `External API calls must run inside withCronRun(jobName, fn) — ` +
        `see .claude/rules/cost-discipline.md ("no live API in user request path").`,
    );
  }
  return run;
}

/**
 * Insert a CronRun row with status=RUNNING and return its handle.
 *
 * Callers MUST eventually call closeCronRun(...) — even on failure — to set
 * status + finishedAt. Prefer `withCronRun(...)` which guarantees this.
 */
export async function openCronRun(job: string): Promise<CronRunHandle> {
  const row = await prisma.cronRun.create({
    data: { job, status: "RUNNING" },
    select: { id: true, job: true, startedAt: true },
  });
  return { id: row.id, job: row.job, startedAt: row.startedAt };
}

/**
 * Close a CronRun row. Sets finishedAt = now and the final status. Optional
 * counters can be passed; cost is already incremented by withCostCounter so
 * passing costUsd here is rare (only needed if the caller computed it
 * out-of-band).
 */
export async function closeCronRun(
  id: string,
  status: CronRunStatus,
  itemsProcessed?: number,
  errorMessage?: string,
  costUsd?: number,
): Promise<void> {
  await prisma.cronRun.update({
    where: { id },
    data: {
      status,
      finishedAt: new Date(),
      ...(itemsProcessed != null ? { itemsProcessed } : {}),
      ...(errorMessage != null ? { errorMessage } : {}),
      ...(costUsd != null ? { costUsd } : {}),
    },
  });
}

/**
 * Open a CronRun, bind it to AsyncLocalStorage for the duration of `fn`, then
 * close it. On thrown error, status=FAILED + errorMessage is recorded and the
 * error is re-thrown. Returns whatever fn returns.
 *
 * Nesting note: calling `withCronRun` inside another `withCronRun` opens a
 * fresh row and replaces the ALS context only for that inner frame. The outer
 * CronRun is restored when the inner frame exits — adapters called from the
 * outer scope still attribute cost to the outer run.
 */
export async function withCronRun<T>(
  job: string,
  fn: (ctx: { runId: string; job: string }) => Promise<T>,
): Promise<T> {
  const run = await openCronRun(job);
  try {
    const result = await storage.run({ run }, () =>
      fn({ runId: run.id, job: run.job }),
    );
    await closeCronRun(run.id, "OK");
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort close — never mask the original error.
    try {
      await closeCronRun(run.id, "FAILED", undefined, message);
    } catch {
      // Swallow secondary failure; the original is what the caller cares about.
    }
    throw err;
  }
}

/**
 * Increment costUsd on the open CronRun by `usd`. Use this for adapters whose
 * cost is computed per-call (e.g. per-token billing) rather than fixed.
 *
 * Throws if no CronRun is open.
 */
export async function incrementCost(usd: number, operation = "incrementCost"): Promise<void> {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(
      `[cost-counter] incrementCost requires a non-negative finite number, got ${usd}`,
    );
  }
  const run = assertCronContext(operation);
  if (usd === 0) return;
  await prisma.cronRun.update({
    where: { id: run.id },
    data: { costUsd: { increment: usd } },
  });
}

/**
 * Wrap an adapter call with a fixed unit cost. Use for vendors with stable
 * per-call pricing (e.g. DataForSEO Maps Search at $0.0006/call).
 *
 *   export const mapsSearch = withCostCounter(
 *     "dataforseo.maps.search",
 *     0.0006,
 *     async (params: MapsSearchParams) => { ... }
 *   );
 *
 * The wrapped function preserves its argument shape and return type. It
 * throws if called outside a CronRun (the "no live API" invariant). Cost is
 * incremented AFTER the inner fn resolves; failed calls do not bill.
 */
export function withCostCounter<Args extends readonly unknown[], R>(
  operation: string,
  unitCostUsd: number,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  if (!Number.isFinite(unitCostUsd) || unitCostUsd < 0) {
    throw new Error(
      `[cost-counter] withCostCounter("${operation}") requires a non-negative ` +
        `finite unit cost, got ${unitCostUsd}`,
    );
  }
  return async (...args: Args): Promise<R> => {
    assertCronContext(operation);
    const result = await fn(...args);
    // Increment after success — failed calls don't bill.
    await incrementCost(unitCostUsd, operation);
    return result;
  };
}

/** Test-only: clear the ALS context. Exported for unit tests. */
export const __TEST_ONLY__ = {
  /** Synchronously read the current store (returns undefined if none). */
  peek: () => storage.getStore(),
};
