// Daily cron · shared batch helpers.
//
// Each daily handler is a thin shell around two contracts:
//
//   1. Bounded per-run work — every handler caps how many DB rows it processes
//      per invocation so a single failing row can never run the route past
//      Vercel's 5 min function timeout. The default cap is intentionally
//      conservative (50 items) and overridable via `?limit=N` query param
//      for ad-hoc backfills.
//
//   2. Per-item failure isolation — one item's exception MUST NOT abort the
//      run. `runBatch` catches per-item, accumulates errors, and lets the
//      caller decide whether to mark the CronRun PARTIAL (any failure) or
//      FAILED (every item failed).
//
// The helpers here are pure utilities — they don't open / close CronRuns
// themselves; the handler's `cronHandler(jobName, async ...)` does that.

/**
 * Cap derived from a route's optional `?limit=N` search param.
 *
 * Bounded by `max` so an attacker (or a copy-paste bug) can't drive a
 * single invocation to scan the entire businesses table.
 */
export function resolveBatchLimit(
  req: Request,
  defaultLimit: number,
  max: number,
): number {
  let limit = defaultLimit;
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("limit");
    if (raw != null) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, max);
      }
    }
  } catch {
    // Malformed URL — fall back to default.
  }
  return Math.max(1, Math.min(limit, max));
}

export interface BatchOutcome<TItem> {
  /** Total items the per-item fn was invoked on. */
  attempted: number;
  /** Items whose fn resolved without throwing. */
  succeeded: number;
  /** Items whose fn threw. Each entry has the item + truncated message. */
  failures: Array<{
    item: TItem;
    error: string;
  }>;
}

interface RunBatchOptions {
  /**
   * Max characters from `err.message` to retain on each failure entry. Keeps
   * the CronRun.meta payload bounded even when an adapter throws a 10kB body
   * snippet.
   */
  errorMessageLimit?: number;
}

/**
 * Run `fn` for each item, accumulating per-item success / failure without
 * letting one bad row tank the batch. Caller decides CronRun status based
 * on the returned shape.
 *
 * Items are processed sequentially. Daily handlers favor steady serial
 * throughput over parallel bursts — the per-vendor rate limits in
 * `.claude/rules/scalability.md` are designed around 1–5 req/sec, and any
 * single bad item should not delay the rest of the batch beyond its own
 * per-call timeout (which lives inside the adapter).
 */
export async function runBatch<TItem>(
  items: readonly TItem[],
  fn: (item: TItem) => Promise<void>,
  options: RunBatchOptions = {},
): Promise<BatchOutcome<TItem>> {
  const messageLimit = options.errorMessageLimit ?? 300;
  const outcome: BatchOutcome<TItem> = {
    attempted: items.length,
    succeeded: 0,
    failures: [],
  };
  for (const item of items) {
    try {
      await fn(item);
      outcome.succeeded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome.failures.push({ item, error: message.slice(0, messageLimit) });
    }
  }
  return outcome;
}

/**
 * Decide the CronRun status from a batch outcome.
 *
 *   - Zero failures  → OK
 *   - Any failures   → PARTIAL  (the cron itself completed; some/all items
 *                                 failed but the route returned cleanly)
 *
 * "FAILED" is reserved for handlers that THROW — `cronHandler`'s catch
 * branch closes the run with FAILED + the error message. Per-item batch
 * failures, even if 100%, are still PARTIAL because the orchestration
 * itself worked: meta + per-failure-sample landed on the row.
 *
 * Empty input (`attempted === 0`) is OK — "nothing to do" is a normal
 * outcome for a daily handler that ran after a fresh full backfill.
 */
export function statusFromOutcome(
  outcome: BatchOutcome<unknown>,
): "OK" | "PARTIAL" {
  if (outcome.failures.length === 0) return "OK";
  return "PARTIAL";
}
