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

import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";

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
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // 2026-07-10 · this was a SILENT return — and in production it fired on
    // EVERY run, so the designed accelerator never ran and users waited the
    // full 0–120s for the */2 cron (the run-forensics start-lag root cause).
    // WARN loudly so a misconfigured prod env is visible in Vercel logs instead
    // of presenting as "enrichment is just slow". The every-2-min cron is the
    // guaranteed fallback.
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "kick-dispatch.skipped",
        reason: "missing-env",
        hasCronSecret: false,
        note: "start accelerator disabled (no CRON_SECRET) — runs wait for the */2 cron",
      }),
    );
    return Promise.resolve();
  }

  // 2026-07-10 · resolve the base via getMapslyPublicUrl() — the SAME runtime
  // resolver (MAPSLY_PUBLIC_URL ?? VERCEL_URL, forced to the www host) every other
  // callback uses — instead of the build-inlined `NEXT_PUBLIC_APP_URL`. Two traps
  // that variable carried and this removes: (1) `NEXT_PUBLIC_*` is inlined at BUILD
  // time, so a value set after the running build read as undefined → the kick
  // no-op'd even when "the env is set"; (2) if it was the APEX host, Vercel's
  // apex→www 307 DROPS the Authorization header (the CRON_SECRET Bearer) → the
  // dispatch endpoint 401'd the kick (`kick-dispatch.rejected`). getMapslyPublicUrl
  // is read at runtime and always returns the canonical www host, killing both.
  const base = getMapslyPublicUrl();
  const url = `${base}/api/cron/internal/dispatch`;
  // Returned (not `void`): under `after()` the framework awaits it, keeping the
  // invocation alive until the kick sends. The 15s timeout bounds the socket;
  // the drain itself continues in its OWN invocation regardless.
  return fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  }).then(
    (res) => {
      // A non-2xx (e.g. 401 from Vercel Deployment Protection, or the dispatch
      // endpoint rejecting our CRON_SECRET) means the kick was DELIVERED but
      // REFUSED — the run then silently waits for the cron. Surface it.
      if (!res.ok) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "kick-dispatch.rejected",
            httpStatus: res.status,
            note: "dispatch kick refused — runs wait for the */2 cron",
          }),
        );
      }
      return undefined;
    },
    (err) => {
      // Network blip / timeout / frozen invocation — the every-2-min cron is
      // the guaranteed fallback, but log it so a chronic failure is visible.
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "kick-dispatch.error",
          error: err instanceof Error ? err.message : String(err),
          note: "dispatch kick failed to send — runs wait for the */2 cron",
        }),
      );
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
