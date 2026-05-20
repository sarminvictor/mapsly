// No-live-API middleware · the enforcement boundary.
//
// Two layers:
//
//   1. `requireCronContext(operation)` — re-exported assertion for adapters.
//      Throws if an external API call is attempted from a user request path
//      (no open CronRun in AsyncLocalStorage).
//
//   2. `cronHandler(jobName, fn)` — Route Handler wrapper for app/api/cron/*.
//      Verifies the Authorization Bearer CRON_SECRET, opens a CronRun and
//      binds it to ALS for the duration of fn, then closes with the
//      itemsProcessed / meta the fn returned. On thrown error: CronRun
//      closes with FAILED + errorMessage and the handler returns 500.
//
// Together these mean: every external API call is reachable ONLY through a
// cron-authenticated route, and that route is provably cost-tracked. Per
// .claude/rules/cost-discipline.md and .claude/rules/scalability.md.
//
// PARTIAL status: pass `status: "PARTIAL"` on the CronHandlerResult to
// override the default OK close (e.g. when some batch items succeeded and
// others failed but you want the run recorded as partial-success).

import {
  assertCronContext,
  closeCronRun,
  openCronRun,
  runWithCronRun,
  type CronRunStatus,
} from "@/lib/cost/cost-counter";

/**
 * Adapter-side guard. Call at the top of any function that reaches an
 * external API to fail fast if the caller forgot to open a CronRun.
 *
 * Re-exported from cost-counter.assertCronContext for vocabulary clarity:
 * adapters speak in terms of "live API" boundaries, the underlying mechanic
 * is "is there an open CronRun in ALS?".
 */
export const requireCronContext = assertCronContext;

/**
 * Return shape from a cron handler function.
 *
 * - itemsProcessed → written to CronRun.itemsProcessed at close time
 * - meta → written to CronRun.meta as JSON
 * - status → overrides default OK close (use "PARTIAL" for partial success)
 * - body → response payload (default `{ ok: true, itemsProcessed }`)
 */
export interface CronHandlerResult {
  itemsProcessed?: number;
  meta?: Record<string, unknown>;
  status?: Extract<CronRunStatus, "OK" | "PARTIAL">;
  body?: unknown;
}

interface CronHandlerOptions {
  /**
   * Override the environment variable name used for the bearer token check.
   * Defaults to CRON_SECRET — only set this for tests or alternate routes.
   */
  secretEnvVar?: string;
}

/**
 * Wrap a cron Route Handler function. Returns a (req: Request) => Promise<Response>
 * suitable for export GET / POST in app/api/cron/[...]/route.ts.
 *
 *   export const GET = cronHandler("daily:reviews-delta", async ({ runId }) => {
 *     const businesses = await prisma.business.findMany({ ... });
 *     for (const b of businesses) await refreshReviews(b.id, { runId });
 *     return { itemsProcessed: businesses.length };
 *   });
 *
 * The function body runs inside an open CronRun frame → any cost-counted
 * adapter call increments the row's costUsd. On uncaught throw the row
 * closes with FAILED + errorMessage; on success it closes with OK (or
 * PARTIAL if the fn returned `status: "PARTIAL"`).
 */
export function cronHandler(
  jobName: string,
  fn: (ctx: {
    runId: string;
    job: string;
  }) => Promise<CronHandlerResult | void>,
  options: CronHandlerOptions = {},
): (req: Request) => Promise<Response> {
  const secretEnvVar = options.secretEnvVar ?? "CRON_SECRET";
  return async function handle(req: Request): Promise<Response> {
    const expected = process.env[secretEnvVar];
    if (!expected) {
      return Response.json(
        {
          error: "internal_error",
          message: `${secretEnvVar} not configured on server`,
        },
        { status: 500 },
      );
    }
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const run = await openCronRun(jobName);
    try {
      const result = await runWithCronRun(run, () =>
        fn({ runId: run.id, job: run.job }),
      );

      // Close with status + itemsProcessed + meta from the handler result.
      const status: CronRunStatus = result?.status ?? "OK";
      await closeCronRun(
        run.id,
        status,
        result?.itemsProcessed,
        undefined,
        undefined,
        result?.meta,
      );

      const body =
        result?.body ??
        ({
          ok: true,
          ...(result?.itemsProcessed != null
            ? { itemsProcessed: result.itemsProcessed }
            : {}),
        } as const);
      return Response.json(body, { status: 200 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          event: "cron.handler.failed",
          job: jobName,
          message,
        }),
      );
      // Best-effort close — don't let secondary failure mask the 500.
      try {
        await closeCronRun(run.id, "FAILED", undefined, message);
      } catch {
        /* swallow */
      }
      return Response.json(
        { error: "internal_error", job: jobName },
        { status: 500 },
      );
    }
  };
}
