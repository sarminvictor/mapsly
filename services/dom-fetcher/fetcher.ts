// services/dom-fetcher/fetcher.ts · the Apify DOM-fetch adapter.
//
// Bridges our published "Cloudflare-busting DOM fetcher" actor (source in
// `apify-actors/dom-fetcher/`, id VQmuafAxGueqPgCey) into the app. The actor
// navigates a real browser through a residential proxy, clears the Cloudflare
// JS challenge, and returns the rendered HTML for one or many URLs. ALL parsing
// (contacts, tech, services, AI) happens downstream over that DOM — this
// adapter only fetches.
//
// Cost is the run's ACTUAL Apify usage (billed inside `runActor` via
// usageTotalUsd → incrementCost), so the withCostCounter unit cost is 0 — we
// add no fixed charge on top of the metered run. Cron-context is enforced by
// `runActor` (assertCronContext): a user request path can never reach here.
//
// We do NOT kvCache the HTML — it's far too large for KV and dedup happens
// upstream via per-business freshness (Business.contactsExtractedAt, 90d).
//
// SCALE: pass MANY urls in ONE call. The actor primes the browser/proxy session
// once and loops them, amortizing the heavy Playwright+Chrome warm-up (~6×
// cheaper per lead than one run per URL). `fetchDomsForCell` chunks a large URL
// list into bounded runs so memory stays predictable.

import { z } from "zod";
import { withCostCounter } from "@/lib/cost/cost-counter";
import { runActor } from "@/services/apify";
import {
  DOM_CHUNK_SIZE,
  DOM_MAX_CONCURRENCY,
  DOM_MEMORY_MB,
  DOM_RUN_COST_CEILING_USD,
} from "./scale";

/** Published actor id. Not a secret (it's a public-actor id) → no env var. */
export const DOM_FETCHER_ACTOR_ID = "VQmuafAxGueqPgCey";

/** Cost-attribution tag for the open CronRun + error messages. */
const OPERATION = "dom-fetcher.fetch";

/** Per-URL Apify usage when a finished run omits usageTotalUsd (rare). Scales
 *  with the batch size so the fallback approximates the metered cost. */
const FALLBACK_COST_PER_URL_USD = 0.005;

/** Max URLs the actor accepts in one run (input-schema bound). */
const MAX_URLS_PER_RUN = 1000;

/**
 * Default per-run chunk for `fetchDomsForCell`. Bounds memory + run wall-clock:
 * 250 URLs is a comfortable batch for a 2 GB run at maxConcurrency ~10. Larger
 * cells fan out across multiple sequential runs. Re-exported from
 * {@link DOM_CHUNK_SIZE} (services/dom-fetcher/scale.ts is the single source).
 */
export const CHUNK_SIZE = DOM_CHUNK_SIZE;

/** Run memory for a single-URL fetch — the 1 GB sweet spot (512 MB thrashes). */
export const SINGLE_URL_MEMORY_MB = DOM_MEMORY_MB.single;

/** Run memory for a batched fetch — 2 GB headroom for ~10 parallel browsers. */
export const BATCH_MEMORY_MB = DOM_MEMORY_MB.batch;

/** Hard ceiling on the actor run (it self-times-out around 280s internally). */
const RUN_TIMEOUT_SECS = 600;

// ---- Input schema -------------------------------------------------------

export const DomFetchInputSchema = z.object({
  /** One or more page URLs to render. */
  urls: z.array(z.string().min(1)).min(1).max(MAX_URLS_PER_RUN),
  /** Residential proxy country code (alpha-2). */
  country: z.string().default("US"),
  /** Apify run memory in MB. ~1 GB per parallel browser; never below 1024. */
  memoryMbytes: z.number().int().positive().default(BATCH_MEMORY_MB),
  /** Parallel browsers inside the run (~1 per GB of memory). */
  maxConcurrency: z.number().int().positive().default(DOM_MAX_CONCURRENCY),
  /** Max wait for the Cloudflare JS challenge to clear before retrying. */
  cfWaitMs: z.number().int().positive().default(14000),
});
export type DomFetchInput = z.input<typeof DomFetchInputSchema>;

// ---- Result shape -------------------------------------------------------

/**
 * One per-URL outcome of a DOM fetch. `blocked`/`failed` mark a dead-letter
 * (Cloudflare not cleared, navigation failure) — the consumer treats these as
 * contactScanStatus=FAILED, NEVER as UNREACHABLE (FAILED ≠ no-contacts).
 */
export interface DomResult {
  /** The URL we asked the actor to fetch. */
  url: string;
  /** URL after redirects (success only). */
  finalUrl?: string;
  /** HTTP status from the navigation (may be null on a hard failure). */
  status?: number;
  /** True when the page was blocked (Cloudflare / 403). */
  blocked: boolean;
  /** True when the fetch failed (no usable HTML). */
  failed: boolean;
  /** The rendered DOM (success only). */
  html?: string;
  /** Error message (dead-letter only). */
  error?: string;
}

export interface FetchDomsResult {
  results: DomResult[];
  runId: string;
  /** Actual USD billed to the open CronRun for this run. */
  usageTotalUsd: number;
}

/** The Lighthouse block the actor emits per item when `lighthouse:true`. */
interface RawLighthouse {
  ok?: boolean;
  scores?: {
    performance?: number | null;
    accessibility?: number | null;
    best_practices?: number | null;
    seo?: number | null;
  } | null;
  cwv?: {
    LCP_ms?: number | null;
    CLS?: number | null;
    TBT_ms?: number | null;
    FCP_ms?: number | null;
  } | null;
  fixable_wins?: unknown[];
  lh_seconds?: number | null;
}

/** The raw dataset item shape the actor emits (success OR dead-letter). */
interface RawItem {
  url?: string;
  finalUrl?: string;
  status?: number | null;
  title?: string | null;
  blocked?: boolean;
  failed?: boolean;
  htmlBytes?: number;
  html?: string;
  error?: string;
  lighthouse?: RawLighthouse | null;
}

/** Map one raw dataset item → our typed DomResult. Tolerant of partial rows. */
function toDomResult(it: RawItem): DomResult {
  const blocked = it.blocked === true;
  // A row is a failure if it's flagged failed/blocked OR carries no html.
  const failed =
    it.failed === true || blocked || (it.html == null && it.error != null);
  return {
    url: it.url ?? "",
    ...(it.finalUrl != null ? { finalUrl: it.finalUrl } : {}),
    ...(it.status != null ? { status: it.status } : {}),
    blocked,
    failed,
    ...(it.html != null ? { html: it.html } : {}),
    ...(it.error != null ? { error: it.error } : {}),
  };
}

// ---- Adapter ------------------------------------------------------------

async function fetchDomsRaw(input: DomFetchInput): Promise<FetchDomsResult> {
  const parsed = DomFetchInputSchema.parse(input);
  const { items, runId, usageTotalUsd } = await runActor<RawItem>({
    actorId: DOM_FETCHER_ACTOR_ID,
    operation: OPERATION,
    input: {
      urls: parsed.urls,
      country: parsed.country,
      cfWaitMs: parsed.cfWaitMs,
      maxConcurrency: parsed.maxConcurrency,
      retireBrowserAfterPageCount: 20,
    },
    memoryMbytes: parsed.memoryMbytes,
    timeoutSecs: RUN_TIMEOUT_SECS,
    fallbackCostUsd: FALLBACK_COST_PER_URL_USD * parsed.urls.length,
  });
  return { results: items.map(toDomResult), runId, usageTotalUsd };
}

/**
 * Fetch the rendered DOM for one or more URLs in a single actor run. Uncached
 * (HTML is too large for KV); bills the run's metered Apify usage to the open
 * CronRun. The withCostCounter unit cost is 0 — the variable cost flows through
 * `runActor`. Throws outside a CronRun.
 */
export const fetchDoms = withCostCounter(OPERATION, 0, fetchDomsRaw);

// ---- Cell-batched convenience ------------------------------------------

export interface FetchDomsForCellOptions {
  /** Override run memory. Defaults: 1 GB for a single URL, 2 GB for a batch. */
  memoryMbytes?: number;
  /** Residential proxy country code. Default "US". */
  country?: string;
  /** Parallel browsers inside each run. Default 10. */
  maxConcurrency?: number;
  /** Max wait for the Cloudflare challenge per page. Default 14000ms. */
  cfWaitMs?: number;
  /** Per-run URL chunk size. Default CHUNK_SIZE (250). */
  chunkSize?: number;
  /**
   * Cumulative-cost ceiling (USD) for this whole call. Once the running Apify
   * usage reaches it, no further chunks launch — completed results are returned
   * and the dropped chunk/URL count is logged (`cost-ceiling.hit`, never silent).
   * Default {@link DOM_RUN_COST_CEILING_USD}.
   */
  maxUsageUsd?: number;
}

/** Split an array into fixed-size chunks (last chunk may be smaller). */
function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Fetch DOMs for a whole discovery cell. Chunks the URL list into bounded runs
 * (CHUNK_SIZE each) and calls `fetchDoms` per chunk SEQUENTIALLY so peak memory
 * + Apify concurrency stay predictable. Results are concatenated in input order
 * across chunks; each chunk's cost is billed to the open CronRun via `fetchDoms`.
 *
 * Memory defaults: a single-URL call uses the 1 GB sweet spot; any batch uses
 * 2 GB. Pass `opts.memoryMbytes` to override (e.g. 8 GB for a 500-lead cell).
 *
 * Cost ceiling: before each chunk, if cumulative usage has already reached
 * `opts.maxUsageUsd` (default {@link DOM_RUN_COST_CEILING_USD}) the loop stops
 * and the remaining chunks are dropped — never silently: a structured
 * `cost-ceiling.hit` log records how many chunks/URLs were skipped.
 */
export async function fetchDomsForCell(
  urls: readonly string[],
  opts: FetchDomsForCellOptions = {},
): Promise<FetchDomsResult> {
  const deduped = [...new Set(urls.filter((u) => u && u.trim().length > 0))];
  if (deduped.length === 0) {
    return { results: [], runId: "", usageTotalUsd: 0 };
  }

  const memoryMbytes =
    opts.memoryMbytes ??
    (deduped.length === 1 ? SINGLE_URL_MEMORY_MB : BATCH_MEMORY_MB);
  const size = Math.max(
    1,
    Math.min(opts.chunkSize ?? CHUNK_SIZE, MAX_URLS_PER_RUN),
  );
  const ceiling = opts.maxUsageUsd ?? DOM_RUN_COST_CEILING_USD;

  const chunks = chunk(deduped, size);
  const results: DomResult[] = [];
  let usageTotalUsd = 0;
  let lastRunId = "";

  for (let i = 0; i < chunks.length; i += 1) {
    // Stop BEFORE launching a chunk we can't afford. We check the cumulative
    // spend rather than predicting the next chunk's cost (variable per run).
    if (usageTotalUsd >= ceiling) {
      const droppedChunks = chunks.length - i;
      const droppedUrls = chunks.slice(i).reduce((n, c) => n + c.length, 0);
      console.log(
        JSON.stringify({
          level: "warn",
          event: "cost-ceiling.hit",
          operation: OPERATION,
          ceilingUsd: ceiling,
          usageTotalUsd,
          droppedChunks,
          droppedUrls,
        }),
      );
      break;
    }

    const res = await fetchDoms({
      urls: chunks[i],
      memoryMbytes,
      ...(opts.country != null ? { country: opts.country } : {}),
      ...(opts.maxConcurrency != null
        ? { maxConcurrency: opts.maxConcurrency }
        : {}),
      ...(opts.cfWaitMs != null ? { cfWaitMs: opts.cfWaitMs } : {}),
    });
    results.push(...res.results);
    usageTotalUsd += res.usageTotalUsd;
    lastRunId = res.runId || lastRunId;
  }

  return { results, runId: lastRunId, usageTotalUsd };
}

// ---- Actor-Lighthouse (walled sites only) -------------------------------

/** Normalized scores + CWV from an actor-Lighthouse pass. Scores are 0..100. */
export interface ActorLighthouse {
  ok: boolean;
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  /** Largest Contentful Paint in ms. */
  lcpMs: number | null;
  /** Cumulative Layout Shift (unitless). */
  cls: number | null;
  /** Total Blocking Time in ms (INP proxy in lab data). */
  tbtMs: number | null;
  /** First Contentful Paint in ms. */
  fcpMs: number | null;
}

export interface FetchLighthouseResult {
  /** The parsed Lighthouse block, or null when the actor returned no audit. */
  lighthouse: ActorLighthouse | null;
  runId: string;
  /** Actual USD billed to the open CronRun for this run (~$0.06 @ 4 GB). */
  usageTotalUsd: number;
}

export interface FetchLighthouseOptions {
  /** Residential proxy country code. Default "US". */
  country?: string;
}

/** Map the actor's raw lighthouse block → our normalized ActorLighthouse. */
function toActorLighthouse(
  lh: RawLighthouse | null | undefined,
): ActorLighthouse | null {
  if (!lh) return null;
  const s = lh.scores ?? {};
  const c = lh.cwv ?? {};
  return {
    ok: lh.ok === true,
    performance: numOrNull(s.performance),
    accessibility: numOrNull(s.accessibility),
    bestPractices: numOrNull(s.best_practices),
    seo: numOrNull(s.seo),
    lcpMs: numOrNull(c.LCP_ms),
    cls: numOrNull(c.CLS),
    tbtMs: numOrNull(c.TBT_ms),
    fcpMs: numOrNull(c.FCP_ms),
  };
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Run the actor's in-browser Lighthouse on ONE walled URL. This is the EXPENSIVE
 * path (~$0.06 @ 4 GB) — actor-Lighthouse forces `maxConcurrency:1` and needs
 * the headroom — so it's reserved for Cloudflare-walled sites where the cheap
 * DataForSEO audit only sees the challenge page. Callers MUST cap how many of
 * these they run per invocation (see WALLED_LIGHTHOUSE_LIMIT). Bills the run's
 * metered Apify usage to the open CronRun; throws outside a CronRun.
 */
export async function fetchLighthouse(
  url: string,
  opts: FetchLighthouseOptions = {},
): Promise<FetchLighthouseResult> {
  const { items, runId, usageTotalUsd } = await runActor<RawItem>({
    actorId: DOM_FETCHER_ACTOR_ID,
    operation: OPERATION,
    input: {
      url,
      lighthouse: true,
      country: opts.country ?? "US",
      // Actor-Lighthouse is single-threaded by design — be explicit.
      maxConcurrency: 1,
    },
    memoryMbytes: DOM_MEMORY_MB.lighthouse,
    timeoutSecs: RUN_TIMEOUT_SECS,
    fallbackCostUsd: 0.06,
  });
  const first = items[0];
  return {
    lighthouse: toActorLighthouse(first?.lighthouse),
    runId,
    usageTotalUsd,
  };
}
