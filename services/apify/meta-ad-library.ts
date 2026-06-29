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
import { kvCache } from "@/lib/cache";
import { runActor } from "./client";

/** Published actor id (override via env for a fork / new build). */
const ACTOR_ID = process.env.META_AD_LIBRARY_ACTOR_ID ?? "CcN2BafzaiuLOpCGg";

const OPERATION = "apify.meta-ad-library.search";

/** Apify usage is unpredictable; bill this if a finished run omits
 *  usageTotalUsd (rare). A single batched run is typically a few cents. */
const FALLBACK_COST_USD = 0.02;

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
  runId: string;
  usageTotalUsd: number;
}

// ---- Adapter ------------------------------------------------------------

async function metaAdLibrarySearchRaw(
  query: MetaAdLibraryQuery,
): Promise<MetaAdLibraryResult> {
  const parsed = MetaAdLibraryQuerySchema.parse(query);
  const { items, runId, usageTotalUsd } = await runActor<unknown>({
    actorId: ACTOR_ID,
    operation: OPERATION,
    input: parsed,
    fallbackCostUsd: FALLBACK_COST_USD,
  });
  // Partition: resolution markers (handle→id), advertiser facet rows, and ads.
  // Tolerate per-row drift — skip any malformed item rather than failing the
  // whole batch (Meta reshapes its payload over time). Order matters: the
  // discriminated `recordType` literals are checked BEFORE the ad-row schema so
  // a facet advertiser (no `id`, but lenient adjacent fields) can never be
  // mis-bucketed as an ad.
  const rows: MetaAdRow[] = [];
  const resolutions: MetaPageResolution[] = [];
  const advertisers: MetaAdvertiser[] = [];
  for (const it of items) {
    const res = MetaResolutionSchema.safeParse(it);
    if (res.success) {
      resolutions.push({
        resolvedFromUrl: res.data.resolvedFromUrl,
        pageId: res.data.pageId,
      });
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
  return { rows, resolutions, advertisers, runId, usageTotalUsd };
}

/** Uncached. Bills the open CronRun for the run's usage (via `runActor`). */
export const metaAdLibrarySearchUncached = metaAdLibrarySearchRaw;

/** Cached (6h) by the full normalized query. A cache hit costs nothing. */
export const metaAdLibrarySearch = kvCache(
  "apify:metaads:search",
  { ttl: 6 * 60 * 60, tag: "apify:metaads" },
  metaAdLibrarySearchUncached,
);
