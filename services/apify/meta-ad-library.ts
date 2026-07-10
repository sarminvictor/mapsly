// services/apify/meta-ad-library.ts · consumer for our own Meta Ad Library actor.
//
// Bridges the published Apify actor `mapsly-meta-ad-library` (source in
// `apify-actors/meta-ad-library/`) into the app. The actor scrapes the PUBLIC
// Meta Ad Library — capturing commercial FB/IG/Threads/Messenger/Audience-
// Network ads the official Graph API hides outside the EU.
//
// Cost is the run's actual Apify usage (billed inside `runActor`); cron-context
// is enforced there too. Cache: 6h so a same-day re-trigger dedupes.
//
// SCALE: pass MANY `pageIds` (or `searchTerms`) in ONE call — the actor primes
// the session once and loops them, amortizing the heavy FB JS bundle. The bulk
// cron should batch per (city, country) cell rather than one call per business.

import { z } from "zod";
import { stableHashArgs } from "@/lib/cache";
import { getKv, isKvAvailable } from "@/lib/cache/kv";
import { runActor } from "./client";

/** Published actor id (override via env for a fork / new build). */
const ACTOR_ID = process.env.META_AD_LIBRARY_ACTOR_ID ?? "CcN2BafzaiuLOpCGg";

const OPERATION = "apify.meta-ad-library.search";

/** Apify usage is unpredictable; bill this if a finished run omits
 *  usageTotalUsd (rare). A single batched run is typically a few cents. */
const FALLBACK_COST_USD = 0.02;
/** Meta runs are residential-proxy-dominated (~$2.8/GB-hour), NOT datacenter
 *  compute — so on a timeout (usage finalized after our window) runActor
 *  estimates elapsed×memory at this rate to book the real ~$0.87, not $0.02. */
const META_EST_USD_PER_GB_HOUR = 2.8;

// ---- Schemas ------------------------------------------------------------

/** One ad as the actor emits it (must stay in lockstep with
 *  `apify-actors/meta-ad-library/src/main.js`'s `flattenAd`). */
export const MetaAdRowSchema = z.object({
  id: z.string(),
  pageId: z.string().optional().default(""),
  pageName: z.string().nullable().optional(),
  adCreativeBody: z.string().nullable().optional(),
  linkTitle: z.string().nullable().optional(),
  linkCaption: z.string().nullable().optional(),
  linkDescription: z.string().nullable().optional(),
  linkUrl: z.string().nullable().optional(),
  ctaText: z.string().nullable().optional(),
  displayFormat: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  snapshotUrl: z.string().nullable().optional(),
  /** FACEBOOK · INSTAGRAM · MESSENGER · AUDIENCE_NETWORK · THREADS */
  platforms: z.array(z.string()).default([]),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  isActive: z.boolean().nullable().optional(),
  /** # of near-identical creatives Meta grouped together. */
  collationCount: z.number().nullable().optional(),
  searchTerm: z.string().nullable().optional(),
  pageQuery: z.string().nullable().optional(),
  /** The input handle/URL this ad resolved from (set for pageUrls targets) —
   *  lets the consumer attribute by the exact business it asked about. */
  resolvedFromUrl: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  scrapedAt: z.string().nullable().optional(),
});
export type MetaAdRow = z.infer<typeof MetaAdRowSchema>;

/** A handle→page-id mapping the actor emits per resolved pageUrl (even for
 *  pages with 0 ads) so the consumer can cache the id and skip re-resolving. */
export const MetaResolutionSchema = z.object({
  recordType: z.literal("resolution"),
  resolvedFromUrl: z.string(),
  pageId: z.string(),
});
export interface MetaPageResolution {
  resolvedFromUrl: string;
  pageId: string;
}

/**
 * One advertiser from the Ad Library's facet
 * (`data.ad_library_main.dynamic_filter_options.pages`) — Meta returns this
 * "who advertises for this search" list even when it withholds the per-creative
 * results GraphQL from an automated session, so for keyword searches it's the
 * PRIMARY signal (page id + name + ad count), not the creative rows. Must stay
 * in lockstep with the actor's advertiser push in
 * `apify-actors/meta-ad-library/src/main.js`.
 */
export const MetaAdvertiserSchema = z.object({
  recordType: z.literal("advertiser"),
  pageId: z.string(),
  pageName: z.string().nullable(),
  adCount: z.number().nullable(),
  searchTerm: z.string().nullable(),
  country: z.string().nullable(),
});
export type MetaAdvertiser = z.infer<typeof MetaAdvertiserSchema>;

/**
 * Verified per-run outcome — the discriminator the actor now emits instead of
 * throwing it away. `ok`/`empty_verified` mean the run REACHED Meta's data
 * query (real ads/advertisers, or a genuinely empty market); `blocked`/
 * `timeout`/`error` are silent-failure classes that must NOT be treated as a
 * clean 0 (retryable — do not cache, record AdMarketRun FAILED). `partial`
 * means some targets verified and some silently failed — real data worth
 * keeping, but the run isn't fully trustworthy.
 */
export type MetaRunOutcome =
  | "ok"
  | "empty_verified"
  | "partial"
  | "blocked"
  | "timeout"
  | "error";

/** Per-target status the actor pushes as a `target_status` dataset record. */
export const MetaTargetStatusSchema = z.object({
  recordType: z.literal("target_status"),
  subject: z.string(),
  label: z.string(),
  status: z.enum(["ok", "empty_verified", "blocked", "timeout"]),
  items: z.number().nullable().optional(),
  advertisers: z.number().nullable().optional(),
  graphqlHits: z.number().nullable().optional(),
  country: z.string().nullable().optional(),
});
export type MetaTargetStatus = z.infer<typeof MetaTargetStatusSchema>;

/** The actor's `RUN_SUMMARY` KV record (best-effort — may be absent). */
const MetaRunSummarySchema = z.object({
  outcome: z.enum([
    "ok",
    "empty_verified",
    "partial",
    "blocked",
    "timeout",
    "error",
  ]),
  primerOk: z.boolean().optional(),
  counts: z
    .object({
      ok: z.number(),
      empty_verified: z.number(),
      blocked: z.number(),
      timeout: z.number(),
    })
    .optional(),
  targets: z.array(z.unknown()).optional(),
});

/** Outcomes safe to cache: the run verifiably reached Meta's data query. A
 *  blocked/timeout/error result is transient — caching it would poison the cell
 *  for the whole TTL. `partial` carries real data but isn't fully trustworthy,
 *  so we don't cache it either (cheap to re-run; correctness over a cache hit). */
const CACHEABLE_OUTCOMES: ReadonlySet<MetaRunOutcome> = new Set([
  "ok",
  "empty_verified",
]);

export function isVerifiedMetaOutcome(o: MetaRunOutcome): boolean {
  return CACHEABLE_OUTCOMES.has(o);
}

export const MetaAdLibraryQuerySchema = z
  .object({
    /** Keyword/advertiser-name search (broad — matches ad text). */
    searchTerms: z.array(z.string().min(1)).optional(),
    /** Exact Facebook Page IDs (precise — a business's OWN ads). Preferred. */
    pageIds: z.array(z.string().min(1)).optional(),
    /** FB page handles/URLs (e.g. from a website's Facebook link); the actor
     *  resolves each to a numeric page id, then pulls precisely. */
    pageUrls: z.array(z.string().min(1)).optional(),
    /** ISO alpha-2; the first entry drives the actor's proxy geo. */
    countries: z.array(z.string().length(2)).min(1).default(["CA"]),
    activeStatus: z.enum(["all", "active", "inactive"]).default("all"),
    maxItems: z.number().int().min(1).max(1000).default(100),
  })
  .refine(
    (q) =>
      (q.searchTerms?.length ?? 0) > 0 ||
      (q.pageIds?.length ?? 0) > 0 ||
      (q.pageUrls?.length ?? 0) > 0,
    {
      message: "metaAdLibrarySearch requires searchTerms, pageIds, or pageUrls",
    },
  );
export type MetaAdLibraryQuery = z.input<typeof MetaAdLibraryQuerySchema>;

export interface MetaAdLibraryResult {
  rows: MetaAdRow[];
  /** handle→page-id mappings for every resolved pageUrl (incl. 0-ad pages). */
  resolutions: MetaPageResolution[];
  /** Advertiser facet — the "who advertises for this search" list. For keyword
   *  searches this is usually the only signal (creative rows are withheld). */
  advertisers: MetaAdvertiser[];
  /** Verified per-run outcome (from the actor's RUN_SUMMARY, else inferred from
   *  run status + yield). The consumer keys cache + AdMarketRun status off this
   *  — NOT off `rows.length` (a blocked "0" and a real empty are identical by
   *  length alone). */
  outcome: MetaRunOutcome;
  /** Terminal Apify run status (SUCCEEDED · FAILED · TIMED-OUT · ABORTED). */
  runStatus: string;
  /** Per-target outcomes the actor emitted (empty if it wrote none). */
  targetStatuses: MetaTargetStatus[];
  runId: string;
  usageTotalUsd: number;
  /** P5 · true when usageTotalUsd is an elapsed×memory estimate (timeout case)
   *  — the consumer persists it so the reconcile cron can correct the books. */
  usageWasEstimated: boolean;
  /** P5 · true when this result was served from the 6h KV cache — the consumer
   *  must NOT re-count its cost/runId (they belong to the original run). */
  fromCache?: boolean;
}

// ---- Adapter ------------------------------------------------------------

/**
 * Infer the run outcome from run status + yield when the actor didn't write a
 * RUN_SUMMARY (older actor build, or an unreadable KV store). Conservative: a
 * FAILED run with no verified signal is `blocked` (retryable, not a clean 0),
 * a TIMED-OUT run is `timeout`, otherwise we can't distinguish a block from a
 * genuine empty by length alone — so a SUCCEEDED-with-data is `ok`, and a
 * SUCCEEDED-with-nothing is `empty_verified` only if a target_status proves the
 * data query fired, else `blocked`.
 */
function inferOutcome(
  runStatus: string,
  hasData: boolean,
  targetStatuses: MetaTargetStatus[],
): MetaRunOutcome {
  if (hasData) {
    // Some target silently failed even though we got data elsewhere → partial.
    const anyUnverified = targetStatuses.some(
      (t) => t.status === "blocked" || t.status === "timeout",
    );
    return anyUnverified ? "partial" : "ok";
  }
  if (runStatus === "FAILED") return "blocked";
  if (runStatus === "TIMED-OUT" || runStatus === "ABORTED") return "timeout";
  // SUCCEEDED with 0 data: trust a target_status that reached the data query.
  const anyVerified = targetStatuses.some(
    (t) => t.status === "empty_verified" || t.status === "ok",
  );
  const anyUnverified = targetStatuses.some(
    (t) => t.status === "blocked" || t.status === "timeout",
  );
  if (anyVerified) return anyUnverified ? "partial" : "empty_verified";
  if (anyUnverified) return "blocked";
  // No per-target signal at all on a clean SUCCEEDED-0 → treat as verified empty
  // (the actor without RUN_SUMMARY support behaves as before this hardening).
  return "empty_verified";
}

async function metaAdLibrarySearchRaw(
  query: MetaAdLibraryQuery,
): Promise<MetaAdLibraryResult> {
  const parsed = MetaAdLibraryQuerySchema.parse(query);
  const {
    items,
    runId,
    usageTotalUsd,
    usageWasEstimated,
    runStatus,
    runSummary,
  } = await runActor<unknown>({
    actorId: ACTOR_ID,
    operation: OPERATION,
    input: {
      ...parsed,
      // INC-58 · PIN THE RESIDENTIAL EXIT TO THE TARGET COUNTRY. The Apify
      // platform injects the INPUT_SCHEMA's default proxyConfiguration
      // ({useApifyProxy, RESIDENTIAL} — no countryCode) into every run input,
      // so the actor's own `?? { countryCode }` fallback is dead code and runs
      // exited from RANDOM countries (Italy/US/Ecuador on the failed hvac
      // attempts vs a lucky Canadian exit on the one dental success). A
      // CA-targeted Ad Library query from an Ecuador IP is exactly the geo
      // mismatch Meta soft-blocks (graphqlHits=0 on every target — the "cell
      // looks blocked" signature). Passing it explicitly here turns the
      // proxy-country coin-flip into always-matching, with the CURRENTLY
      // deployed actor (main.js already honors input.proxyConfiguration).
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
        countryCode: parsed.countries[0],
      },
    },
    fallbackCostUsd: FALLBACK_COST_USD,
    estUsdPerGbHour: META_EST_USD_PER_GB_HOUR,
  });
  // Partition: resolution markers (handle→id), per-target status, advertiser
  // facet rows, and ads. Tolerate per-row drift — skip any malformed item
  // rather than failing the whole batch (Meta reshapes its payload over time).
  // Order matters: the discriminated `recordType` literals are checked BEFORE
  // the ad-row schema so a facet advertiser or a status record (no `id`, but
  // lenient adjacent fields) can never be mis-bucketed as an ad.
  const rows: MetaAdRow[] = [];
  const resolutions: MetaPageResolution[] = [];
  const advertisers: MetaAdvertiser[] = [];
  const targetStatuses: MetaTargetStatus[] = [];
  for (const it of items) {
    const res = MetaResolutionSchema.safeParse(it);
    if (res.success) {
      resolutions.push({
        resolvedFromUrl: res.data.resolvedFromUrl,
        pageId: res.data.pageId,
      });
      continue;
    }
    const ts = MetaTargetStatusSchema.safeParse(it);
    if (ts.success) {
      targetStatuses.push(ts.data);
      continue;
    }
    const adv = MetaAdvertiserSchema.safeParse(it);
    if (adv.success) {
      advertisers.push(adv.data);
      continue;
    }
    const r = MetaAdRowSchema.safeParse(it);
    if (r.success) rows.push(r.data);
  }

  // Prefer the actor's authoritative RUN_SUMMARY outcome; fall back to
  // inferring from run status + yield when it's absent (older actor build).
  const summary = MetaRunSummarySchema.safeParse(runSummary);
  const hasData = rows.length > 0 || advertisers.length > 0;
  const outcome: MetaRunOutcome = summary.success
    ? summary.data.outcome
    : inferOutcome(runStatus, hasData, targetStatuses);

  return {
    rows,
    resolutions,
    advertisers,
    outcome,
    runStatus,
    targetStatuses,
    runId,
    usageTotalUsd,
    usageWasEstimated,
  };
}

/** Uncached. Bills the open CronRun for the run's usage (via `runActor`). */
export const metaAdLibrarySearchUncached = metaAdLibrarySearchRaw;

// Cache key: same namespace + TTL + tag the old `kvCache("apify:metaads:search"
// …)` used, so an invalidateCacheTag("apify:metaads") still clears these keys.
const CACHE_PREFIX = "apify:metaads:search";
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const CACHE_TAG = "apify:metaads";

function metaCacheKey(query: MetaAdLibraryQuery): string {
  const parsed = MetaAdLibraryQuerySchema.parse(query);
  // Hash the NORMALIZED query so { pageIds:[…], countries:['CA'] } and its
  // defaults-filled equivalent share a key (same behavior kvCache gave us).
  return `mapsly:${CACHE_PREFIX}:${stableHashArgs([parsed])}`;
}

/**
 * Cached (6h) by the full normalized query — but the cache only ever HOLDS a
 * VERIFIED outcome (`ok` / `empty_verified`, where the run provably reached
 * Meta's data query). A `blocked` / `timeout` / `error` / `partial` result is
 * transient: caching it would poison the cell for the whole TTL and keep
 * serving an empty a re-run would fill (the 6h cache-poisoning bug §9). So:
 *   - read-through on every call (a hit is always a prior verified value → $0);
 *   - on a miss, run uncached, and write through ONLY when the outcome is
 *     verified. Unverified outcomes skip the write → the next trigger retries.
 * Fail-open: any KV error degrades to a direct uncached call.
 */
export async function metaAdLibrarySearch(
  query: MetaAdLibraryQuery,
): Promise<MetaAdLibraryResult> {
  // No KV configured → straight through (same fail-open contract as kvCache).
  if (!isKvAvailable()) return metaAdLibrarySearchUncached(query);
  const kv = getKv();
  if (!kv) return metaAdLibrarySearchUncached(query);

  const key = metaCacheKey(query);

  // 1 · read-through. A stored value is verified by construction (we only ever
  // write verified outcomes), so a hit is safe to return — flagged fromCache so
  // a chunked consumer doesn't re-count the ORIGINAL run's cost/runId as spend
  // of this collection.
  try {
    const cached = await kv.get<MetaAdLibraryResult>(key);
    if (cached !== null && cached !== undefined)
      return { ...cached, fromCache: true };
  } catch {
    // KV read failed — fall through to a direct call; don't fail the caller.
    return metaAdLibrarySearchUncached(query);
  }

  // 2 · miss → run it.
  const result = await metaAdLibrarySearchUncached(query);

  // 3 · write through ONLY for verified outcomes. Best-effort — a failed write
  // just leaves the cache cold for one more cycle.
  if (isVerifiedMetaOutcome(result.outcome)) {
    try {
      await kv.set(key, result, { ex: CACHE_TTL_SECONDS });
      // Index under the tag so invalidateCacheTag("apify:metaads") finds it.
      await kv.set(`mapsly:tag:${CACHE_TAG}:m:${key}`, 1, {
        ex: CACHE_TTL_SECONDS,
      });
    } catch {
      /* best-effort cache write */
    }
  }
  return result;
}
