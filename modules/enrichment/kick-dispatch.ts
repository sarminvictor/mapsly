// kick-dispatch · accelerate a just-enqueued Discovery / EnrichmentRun.
//
// The user-facing actions only enqueue a PENDING row (no live external API in
// the request path). Historically the ONLY thing that drained PENDING work was
// the `*/2 * * * *` dispatch cron — so a user could sit on the mapping screen
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
 * Fire-and-forget the dispatch drain. Resolves immediately (does not block on
 * the HTTP round-trip) and swallows every error — the 2-minute cron is the
 * guaranteed fallback. No-ops silently when the base URL or CRON_SECRET is not
 * configured (e.g. local dev without them set).
 */
export function kickDispatch(): void {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return;

  const url = `${base.replace(/\/$/, "")}/api/cron/internal/dispatch`;
  // Not awaited: we don't want the enqueue path to wait on the drain. The
  // 15s timeout just bounds the dangling socket; the drain itself continues in
  // its own invocation regardless of whether this request-side promise resolves.
  void fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    // Best-effort — the */2 cron is the guaranteed fallback.
  });
}
