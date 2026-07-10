// services/apify/client.ts · shared transport for Apify actor runs.
//
// Mirrors services/dataforseo/client.ts: a single `runActor` helper every
// Apify-backed adapter uses. It:
//   - Enforces the "no live API in user request path" invariant
//     (assertCronContext) — runs only inside an open CronRun.
//   - Tracks the run's VARIABLE cost (run.stats.usageTotalUsd → incrementCost),
//     the same pattern as the DataForSEO reviews adapter.
//   - Starts a run, polls to completion, reads the default dataset's items.
//   - Times out + tolerates transient poll failures.
//
// Auth: APIFY_TOKEN via Authorization header (never in the URL → not logged).
//
// Start+poll model (Boxly "Pattern B"). The webhook/fire-and-forget model
// (Pattern A) is the scale path for the bulk cron and lands later; this
// transport is correct for batched per-run scans within a worker's budget.

import { assertCronContext, incrementCost } from "@/lib/cost/cost-counter";
import { acquireVendorToken } from "@/lib/enrichment/token-bucket-redis";

const DEFAULT_BASE_URL =
  process.env.APIFY_BASE_URL?.replace(/\/+$/, "") ?? "https://api.apify.com/v2";
const DEFAULT_POLL_INTERVAL_MS = 3000;
// Poll past the actor's own run timeout (default 280s) so we read a finished
// run rather than giving up early.
const DEFAULT_MAX_WAIT_MS = 295_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
// WP3-9 · a single start-retry on a transient start failure (429/5xx) so a
// momentary Apify blip doesn't fail the whole cell run. Bounded + jittered.
const START_RETRIES = 1;
const START_RETRY_BASE_MS = 500;
// INC-48 · after the run goes terminal, Apify finalizes `stats.usageTotalUsd` a
// beat later. A single fixed 1.5s re-fetch loses that race under concurrency and
// reads 0 → billing fell back to a flat constant (~1% of actual) and the
// cost-discipline ceiling went blind on Apify. Poll the finalized cost with a
// bounded backoff (~5.6s max) until it's non-zero. Breaks as soon as it lands, so
// a real run pays no more than ~1-2 ticks; only a genuine ~$0 run runs the full
// budget (negligible — any started run consumes compute-units).
const USAGE_REFETCH_ATTEMPTS = 8;
const USAGE_REFETCH_INTERVAL_MS = 700;
// INC-48 part 2 (2026-07-10) · when Apify STILL hasn't finalized usage within our
// window, don't book a flat penny. A TIMED-OUT / ABORTED / FAILED run finalizes
// its billing a killed run's beat later — often past our ~300s function budget —
// so `usageTotalUsd` reads 0 and we fell back to $0.02 while the real bill was
// ~$0.72–1.22 (residential proxy + images on the Meta actor). That under-counted
// Apify ~40× and blinded the cost-discipline ceiling. Estimate from the run's
// actual wall time × provisioned memory instead: the observed effective rate on
// the Meta actor (proxy-dominated, NOT compute) is ~$2.8 per GB-hour. Elapsed-
// scaled, so a genuinely fast run estimates near $0 and only a full-timeout run
// books the realistic ~$0.87. The Phase-5 reconcile cron (apifyRunId) makes the
// lagging ones exact; this keeps the ledger honest synchronously.
// DEFAULT is the DATACENTER compute rate — the DOM-fetcher / Lighthouse actors
// share runActor and are NOT proxy-heavy, so estimating THEIR timeouts at the
// Meta proxy rate would over-book ~20-30× and falsely trip the $5 alert. The
// Meta adapter passes estUsdPerGbHour: 2.8 explicitly (residential proxy).
const DEFAULT_EST_USD_PER_GB_HOUR = 0.4;
// A run-status poll that keeps failing on a NON-retryable status (auth revoked,
// run gone) will never recover — bail after this many consecutive failures with
// the real status instead of stalling the whole maxWait window.
const MAX_CONSECUTIVE_POLL_FAILURES = 6;

/** Apify run statuses that mean "done" (won't change further). */
const TERMINAL_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
]);

// ---- Test seams ---------------------------------------------------------

let _fetchOverride: typeof fetch | null = null;
let _tokenOverride: string | null = null;
let _sleepOverride: ((ms: number) => Promise<void>) | null = null;

export function __setFetchForTesting(fn: typeof fetch | null): void {
  _fetchOverride = fn;
}
export function __setTokenForTesting(t: string | null): void {
  _tokenOverride = t;
}
export function __setSleepForTesting(
  fn: ((ms: number) => Promise<void>) | null,
): void {
  _sleepOverride = fn;
}

function getFetch(): typeof fetch {
  return _fetchOverride ?? globalThis.fetch;
}
function getSleep(): (ms: number) => Promise<void> {
  return _sleepOverride ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}
function getToken(): string {
  const t = _tokenOverride ?? process.env.APIFY_TOKEN;
  if (!t) {
    throw new Error(
      "[apify] APIFY_TOKEN is not set. Add a personal API token to .env.local / Vercel env.",
    );
  }
  return t;
}

// ---- Error --------------------------------------------------------------

export class ApifyError extends Error {
  readonly operation: string;
  readonly status?: string | number;
  constructor(opts: {
    operation: string;
    message: string;
    status?: string | number;
  }) {
    super(`[apify] ${opts.operation}: ${opts.message}`);
    this.name = "ApifyError";
    this.operation = opts.operation;
    this.status = opts.status;
  }
}

// ---- Public API ---------------------------------------------------------

export interface RunActorOptions {
  /** Actor id (e.g. "CcN2BafzaiuLOpCGg") or "username~actor-name" slug. */
  actorId: string;
  /** Actor input — sent as the run's input JSON. */
  input: Record<string, unknown>;
  /** Operation tag for cost attribution + error messages. */
  operation: string;
  memoryMbytes?: number;
  timeoutSecs?: number;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  /** Billed if the finished run doesn't report usageTotalUsd (rare). */
  fallbackCostUsd?: number;
  /**
   * $/GB-hour used to ESTIMATE cost when Apify hasn't finalized usage in our
   * window (the timeout case). Actor-specific: the Meta actor is residential-
   * proxy-dominated (~$2.8), but the DOM-fetcher / Lighthouse actors are
   * datacenter compute (~$0.4). Defaults to the datacenter rate so a benign
   * DOM/Lighthouse timeout doesn't book a Meta-sized COGS and falsely trip the
   * $5 cost-ceiling alert; the Meta adapter passes 2.8 explicitly.
   */
  estUsdPerGbHour?: number;
}

export interface RunActorResult<T> {
  items: T[];
  runId: string;
  /** Actual USD billed to the open CronRun for this run. */
  usageTotalUsd: number;
  /**
   * P5 · true when `usageTotalUsd` is an elapsed×memory ESTIMATE (or the flat
   * fallback), not Apify's finalized figure — the timeout case where Apify
   * finalizes usage after our window (INC-56). The caller should persist this
   * (AdMarketRun.detailJson.costEstimated) so the reconcile cron can fetch the
   * finalized usage by runId later and correct the books.
   */
  usageWasEstimated: boolean;
  /**
   * Terminal Apify run status: SUCCEEDED · FAILED · ABORTED · TIMED-OUT.
   *
   * CONTRACT (CODE-REVIEW #2): a FAILED run NO LONGER THROWS — it returns here
   * with `items: []` (the Meta actor deliberately `Actor.fail()`s on a block and
   * still writes a RUN_SUMMARY). Every caller MUST check `runStatus`/`runSummary`
   * and reconcile requested-vs-returned counts; treating an empty `items` on a
   * FAILED/blocked run as a clean "0 results" would silently drop data AND still
   * bill for the run.
   */
  runStatus: string;
  /**
   * The actor's `RUN_SUMMARY` record from its default key-value store, if it
   * wrote one (our Meta actor does — a machine-readable per-run outcome so the
   * adapter classifies block/timeout/empty instead of guessing from
   * `items.length`). `null` when the actor didn't write one or it's unreadable.
   */
  runSummary: unknown;
}

/**
 * Start an actor run, poll to completion, read its default-dataset items, and
 * bill the run's `usageTotalUsd` to the open CronRun. Throws outside a CronRun
 * (the "no live API in user path" invariant) and on a FAILED run. A TIMED-OUT
 * or ABORTED run is salvaged — its (partial) dataset items are still returned,
 * since a boundary timeout shouldn't discard data we already paid to collect.
 */
export async function runActor<T = unknown>(
  opts: RunActorOptions,
): Promise<RunActorResult<T>> {
  assertCronContext(opts.operation);
  const token = getToken();
  const f = getFetch();
  const base = DEFAULT_BASE_URL;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const memory = opts.memoryMbytes ?? 4096;
  const timeoutSecs = opts.timeoutSecs ?? 280;
  const pollInterval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWait = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  // 1 · start the run. WP3-9 · pace via the apify token bucket (no-op sans
  // Redis) + retry ONCE on a transient start failure (429/5xx) so a momentary
  // Apify blip doesn't fail the whole cell run. A non-retryable status (4xx
  // other than 429) throws immediately.
  const startUrl =
    `${base}/acts/${encodeURIComponent(opts.actorId)}/runs` +
    `?memory=${memory}&timeout=${timeoutSecs}`;
  let startRes: Response | null = null;
  for (let attempt = 0; attempt <= START_RETRIES; attempt++) {
    if (attempt > 0) {
      const capped = Math.min(START_RETRY_BASE_MS * 2 ** (attempt - 1), 4_000);
      await getSleep()(Math.floor(Math.random() * capped)); // full jitter
    }
    await acquireVendorToken("apify");
    startRes = await f(startUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(opts.input),
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    });
    const retryable =
      startRes.status === 429 ||
      startRes.status === 408 ||
      startRes.status >= 500;
    if (startRes.ok || !retryable || attempt === START_RETRIES) break;
  }
  if (!startRes || !startRes.ok) {
    throw new ApifyError({
      operation: opts.operation,
      message: `start HTTP ${startRes?.status ?? "none"}: ${startRes ? (await safeText(startRes)).slice(0, 300) : "no response"}`,
      status: startRes?.status,
    });
  }
  const startJson = (await startRes.json()) as {
    data?: {
      id?: string;
      status?: string;
      defaultDatasetId?: string;
      defaultKeyValueStoreId?: string;
    };
  };
  const runId = startJson.data?.id;
  if (!runId) {
    throw new ApifyError({
      operation: opts.operation,
      message: "start response missing run id",
    });
  }

  // 2 · poll until terminal
  let status = startJson.data?.status ?? "READY";
  let datasetId = startJson.data?.defaultDatasetId;
  let keyValueStoreId = startJson.data?.defaultKeyValueStoreId;
  let usageTotalUsd = 0;
  let consecutivePollFailures = 0;
  const runStartMs = Date.now();
  const deadline = runStartMs + maxWait;
  while (!TERMINAL_STATUSES.has(status)) {
    if (Date.now() > deadline) {
      throw new ApifyError({
        operation: opts.operation,
        message: `run ${runId} did not finish within ${maxWait}ms (last status ${status})`,
        status,
      });
    }
    await getSleep()(pollInterval);
    const runRes = await f(`${base}/actor-runs/${runId}`, {
      headers,
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    });
    if (!runRes.ok) {
      // A non-retryable status (auth revoked, run deleted) never recovers — fail
      // fast with the real status instead of burning the full maxWait then
      // surfacing a misleading timeout. Transient 429/5xx are tolerated for a
      // bounded streak before giving up.
      if (
        runRes.status === 401 ||
        runRes.status === 403 ||
        runRes.status === 404
      ) {
        throw new ApifyError({
          operation: opts.operation,
          message: `run ${runId} poll HTTP ${runRes.status} (non-retryable)`,
          status: runRes.status,
        });
      }
      if (++consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new ApifyError({
          operation: opts.operation,
          message: `run ${runId} poll failed ${consecutivePollFailures}× (last HTTP ${runRes.status})`,
          status: runRes.status,
        });
      }
      continue; // transient — retry next tick
    }
    consecutivePollFailures = 0;
    const runJson = (await runRes.json()) as {
      data?: {
        status?: string;
        defaultDatasetId?: string;
        defaultKeyValueStoreId?: string;
        /** INC-58 · usage lives TOP-LEVEL on the run object. */
        usageTotalUsd?: number;
        stats?: { usageTotalUsd?: number };
      };
    };
    status = runJson.data?.status ?? status;
    datasetId = runJson.data?.defaultDatasetId ?? datasetId;
    keyValueStoreId = runJson.data?.defaultKeyValueStoreId ?? keyValueStoreId;
    usageTotalUsd =
      runJson.data?.usageTotalUsd ??
      runJson.data?.stats?.usageTotalUsd ??
      usageTotalUsd;
  }

  // INC-58 (2026-07-10) · CORRECTED DIAGNOSIS. The run object's usage lives at
  // `data.usageTotalUsd` (TOP-LEVEL) — `data.stats.usageTotalUsd` has NEVER
  // existed on this endpoint, so every poll read `undefined` and billing always
  // fell to the fallback ($0.02 · the blind-books bug). INC-48's "finalizes a
  // beat later" was a misdiagnosis of the same symptom. The top-level field
  // even updates LIVE during the run (verified against a RUNNING run), so the
  // in-loop poll normally has the real figure before terminal. This refetch
  // loop stays as a short belt for the rare 0-at-terminal read; the estimate
  // below is the last resort.
  for (let i = 0; i < USAGE_REFETCH_ATTEMPTS && usageTotalUsd <= 0; i++) {
    try {
      await getSleep()(USAGE_REFETCH_INTERVAL_MS);
      const finalRes = await f(`${base}/actor-runs/${runId}`, {
        headers,
        signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      });
      if (!finalRes.ok) continue;
      const fj = (await finalRes.json()) as {
        data?: {
          usageTotalUsd?: number;
          stats?: { usageTotalUsd?: number };
          defaultDatasetId?: string;
          defaultKeyValueStoreId?: string;
        };
      };
      const fetched = fj.data?.usageTotalUsd ?? fj.data?.stats?.usageTotalUsd;
      if (typeof fetched === "number") {
        usageTotalUsd = fetched;
      }
      datasetId = fj.data?.defaultDatasetId ?? datasetId;
      keyValueStoreId = fj.data?.defaultKeyValueStoreId ?? keyValueStoreId;
    } catch {
      /* keep the polled usageTotalUsd; retry next tick */
    }
  }

  // Bill the run's variable cost exactly once — we paid for it whichever exit
  // path we take below. When Apify never finalized usage in our window (the
  // TIMED-OUT case), fall back to an elapsed×memory estimate rather than the
  // caller's flat penny, so a full-timeout run books its real ~$0.87 instead of
  // $0.02 (INC-48 part 2). Elapsed-scaled → a fast run still estimates ~$0.
  let effectiveFallback = opts.fallbackCostUsd ?? 0;
  const usageWasEstimated = usageTotalUsd <= 0;
  if (usageWasEstimated) {
    const gbHours = (memory / 1024) * ((Date.now() - runStartMs) / 3_600_000);
    const estimate =
      gbHours * (opts.estUsdPerGbHour ?? DEFAULT_EST_USD_PER_GB_HOUR);
    if (estimate > effectiveFallback) effectiveFallback = estimate;
  }
  const billed = usageTotalUsd || effectiveFallback;
  if (billed > 0) await incrementCost(billed, opts.operation);

  // Read the actor's RUN_SUMMARY record (if it wrote one) so the adapter can
  // classify the run's outcome. Best-effort — a run without one is fine; the
  // adapter falls back to run status. This is why a FAILED run is NOT thrown
  // here anymore: our Meta actor deliberately `Actor.fail()`s on block/timeout
  // and still writes a RUN_SUMMARY the adapter needs to see (a thrown opaque
  // error would hide the machine-readable reason).
  const runSummary = keyValueStoreId
    ? await readKvRecord(f, base, headers, keyValueStoreId, "RUN_SUMMARY")
    : null;

  // 3 · read default-dataset items. SUCCEEDED, TIMED-OUT, ABORTED, and FAILED
  // can all carry data: a scraping actor pushes items incrementally, so a run
  // that hit its timeout — or deliberately failed on a partial block after
  // scraping some targets — still has useful results + per-target status rows.
  // Salvage them (we paid) and hand the caller the run status + summary so it
  // decides how to treat the outcome. A clean SUCCEEDED with no dataset is
  // still a genuine error worth surfacing.
  if (!datasetId) {
    if (status === "SUCCEEDED") {
      throw new ApifyError({
        operation: opts.operation,
        message: `run ${runId} succeeded but has no defaultDatasetId`,
      });
    }
    return {
      items: [],
      runId,
      usageTotalUsd: billed,
      usageWasEstimated,
      runStatus: status,
      runSummary,
    };
  }
  const itemsRes = await f(
    `${base}/datasets/${datasetId}/items?clean=true&format=json`,
    { headers, signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS) },
  );
  if (!itemsRes.ok) {
    if (status === "SUCCEEDED") {
      throw new ApifyError({
        operation: opts.operation,
        message: `dataset items HTTP ${itemsRes.status}`,
        status: itemsRes.status,
      });
    }
    return {
      items: [],
      runId,
      usageTotalUsd: billed,
      usageWasEstimated,
      runStatus: status,
      runSummary,
    };
  }
  const items = (await itemsRes.json()) as T[];

  return {
    items: Array.isArray(items) ? items : [],
    runId,
    usageTotalUsd: billed,
    usageWasEstimated,
    runStatus: status,
    runSummary,
  };
}

/**
 * Read a single record from an Apify key-value store. Returns the parsed JSON
 * value, or `null` if the record is absent (404) / unreadable. Best-effort:
 * never throws (a missing summary must not fail the whole run read).
 */
async function readKvRecord(
  f: typeof fetch,
  base: string,
  headers: Record<string, string>,
  storeId: string,
  key: string,
): Promise<unknown> {
  try {
    const res = await f(
      `${base}/key-value-stores/${encodeURIComponent(storeId)}/records/${encodeURIComponent(key)}`,
      { headers, signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return null; // 404 (no such record) or transient — no summary
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
