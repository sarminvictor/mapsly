// kick-dispatch · accelerate a just-enqueued Discovery / EnrichmentRun.
//
// The user-facing actions only enqueue a PENDING row (no live external API in
// the request path). Historically the ONLY thing that drained PENDING work was
// the `every-2-min` dispatch cron — so a user could sit on the mapping screen
// for up to two minutes before mapping even STARTED. This fires a best-effort,
// fire-and-forget POST to that same dispatch endpoint immediately after the
// enqueue (the endpoint's own docs call this out: "also POST-triggerable …
// right after an enqueue"), so PENDING → RUNNING is near-instant in the common
// case.
//
// It is DELIBERATELY best-effort, never awaited into the response, and never
// throws: the dispatch runs in its OWN serverless invocation (its own 300s
// budget), and if the kick fails for any reason — no base URL, no secret, a
// network blip, the endpoint busy — the discovery/run simply stays PENDING and
// the real 2-minute cron drains it. There is no stranding: the work only ever
// leaves PENDING inside a proper cron-context invocation, never in the user's
// request. Call it from inside `after()` so it runs AFTER the response is sent.

/**
 * Fire the dispatch drain. RETURNS the fetch promise (WP3-1) so callers inside
 * `after(() => kickDispatch())` keep the serverless invocation alive until the
 * kick actually sends — a bare `void fetch(...)` could have the invocation
 * frozen/torn down before the socket flushed, silently dropping the kick. The
 * promise still resolves to void and swallows every error — the every-2-min cron is the
 * guaranteed fallback. No-ops (resolved promise) when the base URL or
 * CRON_SECRET is not configured (e.g. local dev without them set).
 */
export function kickDispatch(): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return Promise.resolve();

  const url = `${base.replace(/\/$/, "")}/api/cron/internal/dispatch`;
  // Returned (not `void`): under `after()` the framework awaits it, keeping the
  // invocation alive until the kick sends. The 15s timeout bounds the socket;
  // the drain itself continues in its OWN invocation regardless.
  return fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  }).then(
    () => undefined,
    () => {
      // Best-effort — the every-2-min cron is the guaranteed fallback.
    },
  );
}

/**
 * WP3-1 · Enqueue ONE Boxly worker job that re-POSTs the dispatch drain via a
 * thin /api/internal/rekick-dispatch route. The worker retries on failure, so
 * the self-chain survives a dropped hop (the direct kickDispatch fetch is
 * best-effort and can be lost to a frozen invocation / network blip). Returns
 * whether the re-kick was enqueued; logs the degraded path when the worker is
 * unavailable so the operator can see the chain fell back to the every-2-min cron. Never
 * throws — the cron remains the guaranteed backstop.
 */
export async function enqueueRekickDispatch(): Promise<boolean> {
  const base = process.env.BOXLY_WORKER_BASE_URL;
  const authToken = process.env.BOXLY_WORKER_AUTH_TOKEN;
  if (!base || !authToken) {
    // No worker → the direct fetch + every-2-min cron carry the chain (degraded path).
    console.warn(
      "[kick-dispatch] Boxly worker unset — self-chain relies on the direct kick + every-2-min cron backstop only",
    );
    return false;
  }

  try {
    // Lazy import to avoid a module-load coupling (the client reads env lazily).
    const { enqueueCallbackWebhooks } =
      await import("@/lib/boxly-worker/client");
    const { getMapslyPublicUrl } = await import("@/lib/url/mapsly-public-url");
    await enqueueCallbackWebhooks([
      {
        // One in-flight re-kick at a time — a stable-per-minute taskId lets the
        // worker de-dupe if two ticks both enqueue within the same minute.
        taskId: `mapsly-rekick-${Math.floor(Date.now() / 60_000)}`,
        url: `${getMapslyPublicUrl()}/api/internal/rekick-dispatch`,
        payload: {},
        callerLabel: "mapsly:rekick-dispatch",
        timeoutSec: 30,
      },
    ]);
    return true;
  } catch (err) {
    console.warn(
      `[kick-dispatch] re-kick enqueue failed: ${err instanceof Error ? err.message : String(err)} · every-2-min cron backstop remains`,
    );
    return false;
  }
}
