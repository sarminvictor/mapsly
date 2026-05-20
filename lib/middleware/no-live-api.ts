// No-live-API middleware · the enforcement boundary.
//
// Two layers:
//
//   1. `requireCronContext(operation)` — re-exported assertion for adapters.
//      Throws if an external API call is attempted from a user request path
//      (no open CronRun in AsyncLocalStorage).
//
//   2. `cronHandler(jobName, fn)` — Route Handler wrapper for app/api/cron/*.
//      Verifies the Authorization Bearer CRON_SECRET, opens a CronRun via
//      withCronRun (binds it to ALS for the request), invokes fn, and
//      returns the appropriate Response. On thrown error: CronRun closes
//      with status=FAILED and the handler returns 500.
//
// Together these mean: every external API call is reachable ONLY through a
// cron-authenticated route, and that route is provably cost-tracked. Per
// .claude/rules/cost-discipline.md and .claude/rules/scalability.md.
//
// PARTIAL status: cronHandler always closes with OK on success and FAILED on
// throw. Cron jobs that need PARTIAL semantics (some items succeeded, some
// failed, overall worth recording) should use the lower-level openCronRun +
// closeCronRun pair directly instead of cronHandler / withCronRun.

import {
  assertCronContext,
  withCronRun,
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
 * Return shape from a cron handler function. itemsProcessed feeds the JSON
 * body returned to the cron caller; cronHandler does not write
 * CronRun.itemsProcessed itself (use closeCronRun directly if that's needed).
 * `body` overrides the default `{ ok: true }` response payload.
 */
export interface CronHandlerResult {
  itemsProcessed?: number;
  meta?: Record<string, unknown>;
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
 * The function body runs inside withCronRun → an open CronRun is available
 * to all transitively-called adapters. Any cost-counted call increments the
 * row's costUsd. On uncaught throw the row closes with FAILED and the
 * handler returns 500.
 */
export function cronHandler(
  jobName: string,
  fn: (ctx: { runId: string; job: string }) => Promise<CronHandlerResult | void>,
  options: CronHandlerOptions = {},
): (req: Request) => Promise<Response> {
  const secretEnvVar = options.secretEnvVar ?? "CRON_SECRET";
  return async function handle(req: Request): Promise<Response> {
    const expected = process.env[secretEnvVar];
    if (!expected) {
      // Misconfiguration: fail closed. Better than running unauthenticated.
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

    let result: CronHandlerResult | void;
    try {
      await withCronRun(jobName, async (ctx) => {
        result = await fn(ctx);
      });
      const body = (result && result.body) ?? {
        ok: true,
        ...(result && result.itemsProcessed != null
          ? { itemsProcessed: result.itemsProcessed }
          : {}),
      };
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
      return Response.json(
        { error: "internal_error", job: jobName },
        { status: 500 },
      );
    }
  };
}
