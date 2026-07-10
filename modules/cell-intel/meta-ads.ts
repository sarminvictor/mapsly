// modules/cell-intel/meta-ads.ts · per-cell Meta Ad Library collector (Phase 6).
//
// Run ONCE per cell, cache 30 days, serve from DB if fresh. For a cell:
//   1. If a fresh (≤30d) AdMarketRun(platform=META) exists → served-from-DB ($0).
//   2. Else run the Apify Meta adapter ONCE for the cell (one actor run that
//      batches BOTH the market service+city search AND every cell business's FB
//      page target — pageUrls the actor resolves, pageIds it pulls precisely),
//      then persist:
//        - Business.fbPageId SEEDED from the run's resolutions (resolvedFromUrl
//          → pageId) so this run's attribution — and every future cell scan —
//          joins reliably on fbPageId === ad.pageId (the authoritative key).
//        - AdLibraryEntry rows (attributed to indexed businesses by fbPageId
//          first, domain/name only as a last-resort fallback) — per-business
//          ad creatives; PLUS a minimal facet-derived placeholder for a matched
//          business that advertises but whose creatives Meta withheld (so
//          has_active_meta_ads / meta_ad_count / not_advertising fire).
//        - AdMarketAdvertiser rows (per-advertiser aggregate for the cell).
//        - one AdMarketRun(platform=META) telemetry row (advertiserCount,
//          adCount, cost).
//
// Billing is UNCHANGED — still ONE actor run per cell (Meta's cost basis). The
// page targets ride along inside that single run; they do NOT make it
// per-business billing.
//
// MUST run inside an open CronRun (the Apify adapter enforces this via
// withCostCounter). Cell-dedup mirrors collect-cell-meta.ts; this variant is
// cellKey-driven + adds the AdMarketRun freshness marker + per-business
// AdLibraryEntry attribution.

import prisma, { Prisma } from "@/lib/prisma";
import {
  metaAdLibrarySearch,
  type MetaAdLibraryQuery,
  type MetaAdRow,
  type MetaAdvertiser,
  type MetaPageResolution,
  type MetaRunOutcome,
  type MetaTargetStatus,
} from "@/services/apify";
import { matchStrength } from "@/modules/ads-intel/match";
import {
  isCellRunFresh,
  latestAdMarketRun,
  CELL_INTEL_FRESHNESS_DAYS,
} from "./freshness";
import {
  shouldRunMetaCell,
  recordMetaCellOutcome,
} from "@/lib/cost/meta-block-breaker";
import {
  resolveCellContext,
  hostOf,
  type CellContext,
  type CellBusiness,
} from "./cell-context";

/** Coerce a typed value to a Prisma Json input. */
function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

const MAX_SERVICES = 5;
const MAX_ADVERTISERS = 60;
const MAX_CREATIVES = 6;
const META_MAX_ITEMS = 150;
// 2026-07-10 · FACET-FIRST. The cell no longer sends per-business pageUrls (the
// HTTP resolve Meta blocks), so a cell is now ONE facet query and these chunking
// knobs are effectively single-run. They stay so the reconcile/continuation
// scaffolding (pendingTargets, wall budget) keeps compiling if pageUrls ever
// return; with pageUrls=[] the chunk loop runs exactly once.
const META_TARGETS_PER_RUN = 20;
const META_CELL_WALL_BUDGET_MS = 180_000;
// 2026-07-10 · PER-CELL BLOCK COOLDOWN. A cell that keeps returning graphqlHits=0
// — a persistent soft-block OR a genuinely sparse keyword market the actor can't
// tell apart — otherwise retries every dispatch tick, burning ~$0.20/attempt (an
// hvac-contractor-Kelowna cell hit 7+ FAILED runs in an hour). After this many
// consecutive all-FAILED runs within the window, the cell is deferred (no burn)
// until the window elapses, then retries ONCE; a single OK/PARTIAL resets it.
const META_BLOCK_COOLDOWN_FAILS = 3;
const META_BLOCK_COOLDOWN_HOURS = 12;

/**
 * Combine per-chunk outcomes into ONE cell outcome. Verified everywhere → ok
 * (or empty_verified when every chunk verified-empty). A mix of verified and
 * unverified → partial (real data, not fully trustworthy — uncacheable). All
 * hard-unverified → the dominant failure class.
 */
function combineMetaOutcomes(outcomes: MetaRunOutcome[]): MetaRunOutcome {
  if (outcomes.length === 0) return "error";
  if (outcomes.length === 1) return outcomes[0];
  const verified = (o: MetaRunOutcome) => o === "ok" || o === "empty_verified";
  if (outcomes.every(verified)) {
    return outcomes.every((o) => o === "empty_verified")
      ? "empty_verified"
      : "ok";
  }
  if (outcomes.some((o) => verified(o) || o === "partial")) return "partial";
  if (outcomes.includes("blocked")) return "blocked";
  if (outcomes.includes("timeout")) return "timeout";
  return "error";
}

/** The detailJson payload persisted on every META AdMarketRun row (P5). */
function metaDetailJson(o: {
  outcome: MetaRunOutcome | "error";
  apifyRunIds: string[];
  chunksLaunched: number;
  chunksPlanned: number;
  pendingTargets: number;
  costEstimated: boolean;
  errors: string[];
}): Prisma.InputJsonValue {
  return {
    outcome: o.outcome,
    apifyRunIds: o.apifyRunIds,
    chunksLaunched: o.chunksLaunched,
    chunksPlanned: o.chunksPlanned,
    pendingTargets: o.pendingTargets,
    costEstimated: o.costEstimated,
    errors: o.errors.slice(0, 5),
  };
}

export interface CellMetaAdsResult {
  cellKey: string;
  /**
   * "served-from-db" (fresh), "collected" (ran adapter), "skipped" (no cell),
   * "deferred" (R2 · circuit breaker OPEN — Meta is block-storming, so we did
   * NOT burn proxy $; the cell stays retryable, no AdMarketRun written).
   */
  outcome: "served-from-db" | "collected" | "skipped" | "deferred";
  advertiserCount: number;
  adCount: number;
  /** AdLibraryEntry rows persisted (per-business attribution). */
  entriesUpserted: number;
  /** Business.fbPageId values newly seeded from this run's resolutions. */
  fbPageIdsSeeded: number;
  costUsd: number;
  runId: string | null;
  errors: string[];
}

interface MarketCreative {
  externalAdId: string;
  body: string | null;
  previewUrl: string | null;
  format: string | null;
  landingUrl: string | null;
  platforms: string[];
  startedAt: string | null;
}

interface Agg {
  pageId: string;
  pageName: string;
  handle: string | null;
  adCount: number;
  seenAdIds: Set<string>;
  platforms: Set<string>;
  services: Set<string>;
  runningSince: Date | null;
  creatives: MarketCreative[];
}

function handleFromLinkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:instagram|facebook)\.com\/([a-zA-Z0-9._-]{2,})/i);
  return m ? m[1].replace(/\/+$/, "") : null;
}

function parseDateOrNull(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Build the service+city search terms for the cell's Meta market run. */
function buildSearchTerms(ctx: CellContext): string[] {
  const base = ctx.categorySlug.replace(/[_-]+/g, " ").trim();
  const city = ctx.cityLabel;
  const term = city ? `${base} ${city}`.trim() : base;
  return [term].filter((t) => t.length >= 2).slice(0, MAX_SERVICES);
}

/**
 * Attribute a Meta ad to exactly one indexed business by strongest signal:
 *   1. exact fbPageId match (the page id we cached for that business),
 *   2. a distinctive page-name token match (fallback, generic words excluded).
 * Domain attribution falls back to the advertiser handle vs the business host.
 * Returns the businessId or null (competitor not in our index).
 */
function attributeAd(
  row: MetaAdRow,
  byPageId: Map<string, string>,
  businesses: readonly CellBusiness[],
): string | null {
  const pid = row.pageId || "";
  if (pid && byPageId.has(pid)) return byPageId.get(pid)!;

  const handle = handleFromLinkUrl(row.linkUrl);
  if (handle) {
    for (const b of businesses) {
      const host = hostOf(b);
      // handle like "soleabrickell" vs host "soleabrickell.com"
      if (host && host.split(".")[0] === handle.toLowerCase()) return b.id;
    }
  }

  let best: { id: string; score: number } | null = null;
  for (const b of businesses) {
    const score = matchStrength(row.pageName, b.name);
    if (score > 0 && (!best || score > best.score)) best = { id: b.id, score };
  }
  return best?.id ?? null;
}

/**
 * Collect the Meta ad market for one cell, gated by the 30-day freshness window.
 * MUST run inside an open CronRun.
 *
 * P5 · `opts.ignoreFreshness` is the meta-reconcile cron's CONTINUATION path: a
 * budget-stopped collection wrote a PARTIAL row (which anchors the freshness
 * gate), so the cron must bypass the gate to re-run. (Facet-first · 2026-07-10:
 * a cell is now ONE facet query, so continuation is rarely needed; a re-run just
 * re-fetches the facet, and verified queries hit the 6h cache at $0.)
 */
export async function runMetaAdsForCell(
  cellKey: string,
  now: Date = new Date(),
  opts?: { ignoreFreshness?: boolean },
): Promise<CellMetaAdsResult> {
  const result: CellMetaAdsResult = {
    cellKey,
    outcome: "skipped",
    advertiserCount: 0,
    adCount: 0,
    entriesUpserted: 0,
    fbPageIdsSeeded: 0,
    costUsd: 0,
    runId: null,
    errors: [],
  };

  // 1 · freshness gate — serve from DB if a recent run exists.
  if (!opts?.ignoreFreshness) {
    const last = await latestAdMarketRun(cellKey, "META");
    if (isCellRunFresh(last?.ranAt ?? null, now, CELL_INTEL_FRESHNESS_DAYS)) {
      result.outcome = "served-from-db";
      return result;
    }
  }

  // 1b · R2 · circuit breaker. When Meta is block-storming (recent block-rate
  // over threshold), the breaker is OPEN — skip this run so we don't burn Apify
  // residential proxy $ hitting the same wall. The cell stays retryable (no
  // AdMarketRun row written → the 30-day gate isn't touched, the dead-letter
  // query won't see a fresh FAILED). Degrades OPEN (allow) with no Redis.
  const gate = await shouldRunMetaCell({ nowMs: () => now.getTime() });
  if (!gate.allow) {
    result.outcome = "deferred";
    result.errors.push(`meta-breaker:${gate.reason}`);
    logMetaOutcome({ cellKey, outcome: "deferred", costUsd: 0, runId: null });
    return result;
  }

  // 1c · PER-CELL BLOCK COOLDOWN. If the last META_BLOCK_COOLDOWN_FAILS runs for
  // this cell were ALL FAILED and the most recent is within the cooldown window,
  // DEFER — don't burn ~$0.20 hitting the same wall every dispatch. The cell stays
  // retryable (no AdMarketRun written → the 30-day gate + dead-letter untouched),
  // but at most once per window; a single OK/PARTIAL breaks the streak. Bypassed
  // on the reconcile continuation path (ignoreFreshness). One cheap indexed read.
  if (!opts?.ignoreFreshness) {
    const recent = await prisma.adMarketRun.findMany({
      where: { cellKey, platform: "META" },
      orderBy: { ranAt: "desc" },
      take: META_BLOCK_COOLDOWN_FAILS,
      select: { status: true, ranAt: true },
    });
    const allFailed =
      recent.length >= META_BLOCK_COOLDOWN_FAILS &&
      recent.every((r) => r.status === "FAILED");
    const lastAt = recent[0]?.ranAt ?? null;
    const inCooldown =
      lastAt !== null &&
      now.getTime() - lastAt.getTime() <
        META_BLOCK_COOLDOWN_HOURS * 3_600_000;
    if (allFailed && inCooldown) {
      result.outcome = "deferred";
      result.errors.push(`meta-cooldown:${recent.length}-fails`);
      logMetaOutcome({ cellKey, outcome: "deferred", costUsd: 0, runId: null });
      return result;
    }
  }

  // 2 · resolve cell context (category, metro, businesses, location code).
  const ctx = await resolveCellContext(cellKey);
  if (!ctx) {
    result.errors.push(`unresolvable-cell:${cellKey}`);
    return result;
  }

  const searchTerms = buildSearchTerms(ctx);

  // 2b · FACET-FIRST (2026-07-10 · prod-fail fix). We NO LONGER resolve each
  // business's website/Facebook-handle to a page id via a per-business page
  // target. Meta blocks the raw HTTP resolve, so that path failed for ~every
  // PRODUCTION cell (20 "Could not resolve" per run → the run FAILED with 0
  // targets) — the exact reason cells failed in prod while keyword tests passed.
  // The advertiser FACET (searchTerms) already carries every advertiser's pageId
  // + name, so per-business attribution + fbPageId seeding now come from
  // NAME-MATCHING the facet (step 4c) — free, no HTTP, no fragile page targets.
  // pageUrls are therefore NOT sent to the actor; already-resolved businesses
  // still feed their pageIds for a precise, reliable pull. (Per-business ad
  // CREATIVES — the page-id path — remain the hard path; see the forensics report.)
  const pageUrls: string[] = [];
  const pageIds = ctx.businesses
    .map((b) => b.fbPageId)
    .filter((id): id is string => !!id);
  // No pageUrls → no run-emitted resolutions; kept empty so step 3b no-ops.
  const bizByPageUrl = new Map<string, string>();

  if (
    searchTerms.length === 0 &&
    pageUrls.length === 0 &&
    pageIds.length === 0
  ) {
    result.errors.push(`no-search-terms:${cellKey}`);
    return result;
  }

  // 3 · CHUNKED Meta market runs for the cell (P5). Each actor run gets ≤
  // META_TARGETS_PER_RUN pageUrls so it FINISHES within the actor timeout; the
  // first chunk also carries the searchTerms market facet + precise pageIds.
  // Still ONE cell charge — chunks are a COGS/wall-time shape, not a billing one.
  const country2 = (ctx.country || "US").toUpperCase().slice(0, 2);
  const rows: MetaAdRow[] = [];
  const advertisers: MetaAdvertiser[] = [];
  const resolutions: MetaPageResolution[] = [];
  // Per-target statuses (A4) — the run's own evidence that Meta's data query
  // actually fired (status ok/empty_verified, graphqlHits ≥ 1). Feeds the
  // soft-block suspicion heuristic before an OK-with-0 is written.
  const targetStatuses: MetaTargetStatus[] = [];

  const urlChunks: string[][] = [];
  for (let i = 0; i < pageUrls.length; i += META_TARGETS_PER_RUN) {
    urlChunks.push(pageUrls.slice(i, i + META_TARGETS_PER_RUN));
  }
  const queries: MetaAdLibraryQuery[] =
    urlChunks.length === 0
      ? [
          {
            ...(searchTerms.length > 0 ? { searchTerms } : {}),
            ...(pageIds.length > 0 ? { pageIds } : {}),
            countries: [country2],
            activeStatus: "active",
            maxItems: META_MAX_ITEMS,
          },
        ]
      : urlChunks.map((chunk, i) => ({
          ...(i === 0 && searchTerms.length > 0 ? { searchTerms } : {}),
          ...(i === 0 && pageIds.length > 0 ? { pageIds } : {}),
          pageUrls: chunk,
          countries: [country2],
          activeStatus: "active",
          maxItems: META_MAX_ITEMS,
        }));

  const outcomes: MetaRunOutcome[] = [];
  const apifyRunIds: string[] = [];
  let costEstimated = false;
  let chunksLaunched = 0;
  let pendingTargets = 0;
  const wallStartMs = Date.now();
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    // Wall budget — the enrich-cell route (and the inline fan-out fallback)
    // lives under a ~300s function ceiling. Stop LAUNCHING new chunks past the
    // budget; the remainder is finished by the meta-reconcile cron.
    if (i > 0 && Date.now() - wallStartMs > META_CELL_WALL_BUDGET_MS) {
      pendingTargets += q.pageUrls?.length ?? 0;
      continue;
    }
    try {
      const out = await metaAdLibrarySearch(q);
      chunksLaunched += 1;
      rows.push(...out.rows);
      advertisers.push(...(out.advertisers ?? []));
      resolutions.push(...(out.resolutions ?? []));
      targetStatuses.push(...(out.targetStatuses ?? []));
      outcomes.push(out.outcome);
      // A 6h-cache hit re-serves a PRIOR run's data — its cost/runId were that
      // run's, so this collection doesn't re-count them.
      if (!out.fromCache) {
        result.costUsd += out.usageTotalUsd;
        if (out.runId) apifyRunIds.push(out.runId);
        if (out.usageWasEstimated) costEstimated = true;
      }
    } catch (e) {
      // A thrown chunk (start failure after retries) → record, stop launching
      // more (start failures repeat); anything already collected still persists
      // below. The THROWING chunk's OWN targets are unscanned too, so the
      // accrual starts at j=i (not i+1) — else the reconcile cron never
      // re-scans them and they vanish for 30 days (verifier hole · the exact
      // invisible-loss class this fix targets).
      result.errors.push(
        `meta-chunk-${i}:${(e as Error).message}`.slice(0, 200),
      );
      outcomes.push("error");
      for (let j = i; j < queries.length; j++) {
        pendingTargets += queries[j].pageUrls?.length ?? 0;
      }
      break;
    }
  }
  result.runId = apifyRunIds[0] ?? null;

  // Verified outcome, combined across chunks (block vs timeout vs real empty).
  // Drives the AdMarketRun status below so the coverage-matrix reads
  // "failed/retryable" for a blocked cell — NOT "ran, empty". Unfinished chunks
  // (pendingTargets > 0) cap the outcome at `partial` so the cell is never
  // cached/anchored as fully-verified while targets remain.
  let outcome: MetaRunOutcome = combineMetaOutcomes(outcomes);
  if (
    pendingTargets > 0 &&
    (outcome === "ok" || outcome === "empty_verified")
  ) {
    outcome = "partial";
  }
  const detailBase = {
    apifyRunIds,
    chunksLaunched,
    chunksPlanned: queries.length,
    pendingTargets,
    costEstimated,
  };

  // Every chunk threw before anything was collected → the old thrown-run path:
  // FAILED row (retryable), teach the breaker, stop.
  if (chunksLaunched === 0) {
    await prisma.adMarketRun.create({
      data: {
        cellKey,
        platform: "META",
        status: "FAILED",
        costUsd: result.costUsd,
        advertiserCount: 0,
        adCount: 0,
        apifyRunId: result.runId,
        detailJson: metaDetailJson({
          ...detailBase,
          outcome: "error",
          errors: result.errors,
        }),
      },
    });
    // R2 · a thrown run is a block class → teach the breaker + log the spend.
    await recordMetaCellOutcome(false, { nowMs: () => now.getTime() });
    logMetaOutcome({
      cellKey,
      outcome: "error",
      costUsd: result.costUsd,
      runId: result.runId,
    });
    return result;
  }

  // 3b · SEED fbPageId from the run's resolutions BEFORE the salvage gate
  // (2026-07-10 · C1 · run-forensics). A timed-out/blocked run that produced page
  // RESOLUTIONS (resolvedFromUrl → numeric pageId) but no ad/advertiser rows used
  // to hit the FAILED early-return below and DISCARD those resolutions — so every
  // retry re-paid the residential-proxy $ to re-resolve the same ~10-15 page ids
  // (six hvac runs in one day burned this). Seeding here makes the resolutions
  // durable regardless of the ad OUTCOME, so a retry feeds precise pageIds and is
  // cheaper; it also primes `byPageId` for this run's own attribution on the
  // salvage/verified path below. Only set when currently null (never clobber a
  // hand-corrected id); best-effort per row (one failure must not abort the run).
  const byPageId = new Map<string, string>();
  for (const b of ctx.businesses) {
    if (b.fbPageId) byPageId.set(b.fbPageId, b.id);
  }
  for (const r of resolutions) {
    const businessId = bizByPageUrl.get(r.resolvedFromUrl);
    if (!businessId || !r.pageId) continue;
    if (!byPageId.has(r.pageId)) byPageId.set(r.pageId, businessId);
    try {
      await prisma.business.updateMany({
        where: { id: businessId, fbPageId: null },
        data: { fbPageId: r.pageId },
      });
      result.fbPageIdsSeeded += 1;
    } catch (e) {
      result.errors.push(`seed-fbpageid:${(e as Error).message}`.slice(0, 200));
    }
  }

  // SALVAGE (2026-07-10 · Viktor's decision) · a blocked/timeout/error run that
  // STILL delivered data (creative rows OR the advertiser facet) is treated as a
  // SUCCESS, not discarded. The Meta actor routinely hits its 280s timeout AFTER
  // Meta has already returned the "who advertises here" facet — we paid the
  // residential-proxy $ and got real advertisers (43 + 15 on the dental run), so
  // throwing them away and billing nothing was pure waste + an invisible result.
  // We persist the data and mark the run PARTIAL (real, but the run didn't fully
  // verify → the errors[] push below forces PARTIAL at step 7). Only an
  // unverified run with NO salvageable data is a true transient failure: FAILED,
  // retryable, no persistence, freshness gate untouched. (Resolutions are ALREADY
  // seeded above, so even this FAILED path leaves the pageIds durable.)
  const hasSalvageableData = rows.length > 0 || advertisers.length > 0;
  const unverified =
    outcome === "blocked" || outcome === "timeout" || outcome === "error";
  const salvaged = unverified && hasSalvageableData;
  if (unverified && !hasSalvageableData) {
    result.errors.push(`meta-outcome:${outcome}`);
    await prisma.adMarketRun.create({
      data: {
        cellKey,
        platform: "META",
        status: "FAILED",
        costUsd: result.costUsd,
        advertiserCount: 0,
        adCount: 0,
        apifyRunId: result.runId,
        detailJson: metaDetailJson({
          ...detailBase,
          outcome,
          errors: result.errors,
        }),
      },
    });
    // R2 · feed the breaker a block sample (NOT verified) + attribute the spend.
    await recordMetaCellOutcome(false, { nowMs: () => now.getTime() });
    logMetaOutcome({
      cellKey,
      outcome,
      costUsd: result.costUsd,
      runId: result.runId,
    });
    return result;
  }
  if (salvaged) {
    // Real data off an unverified run → mark PARTIAL (forces PARTIAL at step 7)
    // and skip caching (a re-run may complete). NOT a block for the breaker: we
    // reached Meta's data, so recordMetaCellOutcome(true) below still applies.
    result.errors.push(`meta-salvaged:${outcome}`);
  }

  // R2 · a run that reached Meta's data query (ok/empty_verified/partial) is a
  // VERIFIED sample — closes a half-open probe / rolls the block-rate down.
  // (fbPageId resolutions + byPageId were already seeded above the salvage gate.)
  await recordMetaCellOutcome(true, { nowMs: () => now.getTime() });

  // 4 · aggregate rows → advertiser level (dedupe ad ids across terms).
  const byPage = new Map<string, Agg>();
  for (const r of rows) {
    const pid = r.pageId || "";
    if (!pid) continue;
    let g = byPage.get(pid);
    if (!g) {
      g = {
        pageId: pid,
        pageName: r.pageName ?? "(unknown)",
        handle: null,
        adCount: 0,
        seenAdIds: new Set<string>(),
        platforms: new Set<string>(),
        services: new Set<string>(),
        runningSince: null,
        creatives: [],
      };
      byPage.set(pid, g);
    }
    for (const p of r.platforms ?? []) g.platforms.add(p);
    if (r.searchTerm) g.services.add(r.searchTerm);
    if (!g.handle) g.handle = handleFromLinkUrl(r.linkUrl);
    const sd = parseDateOrNull(r.startDate);
    if (sd && (!g.runningSince || sd < g.runningSince)) g.runningSince = sd;
    if (r.id && !g.seenAdIds.has(r.id)) {
      g.seenAdIds.add(r.id);
      g.adCount += 1;
      if (g.creatives.length < MAX_CREATIVES) {
        g.creatives.push({
          externalAdId: r.id,
          body: r.adCreativeBody ?? null,
          previewUrl: r.imageUrl ?? null,
          format: r.displayFormat ?? null,
          landingUrl: r.linkUrl ?? null,
          platforms: r.platforms ?? [],
          startedAt: r.startDate ?? null,
        });
      }
    }
  }

  // 4b · merge the advertiser FACET (dynamic_filter_options.pages). For keyword
  // searches this is Meta's PRIMARY signal — it returns "who advertises for this
  // term" + an ad count even when it withholds the per-creative results GraphQL
  // from an automated session (the common case → 0 creative rows). Without this,
  // a cell whose only signal is the facet records 0 advertisers (the meta_ads
  // "always 0" bug: rows were consumed, the facet was dropped on the floor).
  for (const a of advertisers) {
    const pid = a.pageId || "";
    if (!pid) continue;
    let g = byPage.get(pid);
    if (!g) {
      g = {
        pageId: pid,
        pageName: a.pageName ?? "(unknown)",
        handle: null,
        adCount: 0,
        seenAdIds: new Set<string>(),
        platforms: new Set<string>(),
        services: new Set<string>(),
        runningSince: null,
        creatives: [],
      };
      byPage.set(pid, g);
    }
    if ((!g.pageName || g.pageName === "(unknown)") && a.pageName)
      g.pageName = a.pageName;
    if (a.searchTerm) g.services.add(a.searchTerm);
    // Facet ad count (no creatives attached) — take it when it exceeds the
    // creative-derived count so the advertiser's activity isn't undercounted.
    if (typeof a.adCount === "number" && a.adCount > g.adCount)
      g.adCount = a.adCount;
  }

  // 4c · FACET-NAME fbPageId SEEDING (2026-07-10 · facet-first). Replaces the
  // per-business pageUrl resolution dropped in step 2b: the facet already carries
  // each advertiser's pageId + name, so match a facet advertiser to a cell
  // business by name and seed that business's fbPageId FROM the facet — no HTTP,
  // no fragile page targets. This keeps per-business Meta signals working (step 6b
  // upserts the placeholder AdLibraryEntry off byPageId, and step 5's advertiser
  // rows get matchedBusinessId). One business ↔ one pageId (claimedBiz), the best
  // name-match wins, and we only seed when the business's fbPageId is currently
  // null (never clobber a hand-corrected id). Best-effort per row.
  const claimedBiz = new Set<string>(byPageId.values());
  const unresolvedBiz = ctx.businesses.filter((b) => !b.fbPageId);
  for (const a of advertisers) {
    const pid = a.pageId || "";
    if (!pid || byPageId.has(pid) || !a.pageName) continue;
    let best: { id: string; score: number } | null = null;
    for (const b of unresolvedBiz) {
      if (claimedBiz.has(b.id)) continue;
      const score = matchStrength(a.pageName, b.name);
      if (score > 0 && (!best || score > best.score)) best = { id: b.id, score };
    }
    if (!best) continue;
    byPageId.set(pid, best.id);
    claimedBiz.add(best.id);
    try {
      await prisma.business.updateMany({
        where: { id: best.id, fbPageId: null },
        data: { fbPageId: pid },
      });
      result.fbPageIdsSeeded += 1;
    } catch (e) {
      result.errors.push(
        `facet-seed-fbpageid:${(e as Error).message}`.slice(0, 200),
      );
    }
  }

  // 5 · upsert AdMarketAdvertiser (per-advertiser cell aggregate).
  const top = [...byPage.values()]
    .sort((a, b) => b.adCount - a.adCount)
    .slice(0, MAX_ADVERTISERS);

  for (const g of top) {
    const matchedBusinessId = byPageId.get(g.pageId) ?? null;
    try {
      await prisma.adMarketAdvertiser.upsert({
        where: {
          category_city_country_platform_pageId: {
            category: ctx.categorySlug,
            city: ctx.cityLabel,
            country: ctx.country,
            platform: "META",
            pageId: g.pageId,
          },
        },
        create: {
          category: ctx.categorySlug,
          city: ctx.cityLabel,
          country: ctx.country,
          locationCode: ctx.locationCode,
          platform: "META",
          pageId: g.pageId,
          pageName: g.pageName,
          handle: g.handle,
          activeAdCount: g.adCount,
          platforms: [...g.platforms],
          matchedServices: [...g.services],
          runningSince: g.runningSince,
          creatives: asJson(g.creatives),
          matchedBusinessId,
          isActive: true,
        },
        update: {
          pageName: g.pageName,
          handle: g.handle ?? undefined,
          activeAdCount: g.adCount,
          platforms: [...g.platforms],
          matchedServices: [...g.services],
          runningSince: g.runningSince,
          creatives: asJson(g.creatives),
          matchedBusinessId,
          isActive: true,
          lastSeenAt: now,
        },
      });
      result.advertiserCount += 1;
    } catch (e) {
      result.errors.push(`advertiser:${(e as Error).message}`.slice(0, 200));
    }
  }

  // 6 · persist AdLibraryEntry rows for ads attributable to indexed businesses.
  // Derives signal-ready fields (platforms, displayFormat, collationCount,
  // variant counts). Keyed on globally-unique externalAdId so a re-run upserts.
  // Businesses that got a REAL per-ad row this run — so the facet fallback
  // below doesn't also write a synthetic placeholder for them (which would
  // double-count `activeCount` in rollupAds).
  const bizWithRealAd = new Set<string>();
  for (const r of rows) {
    if (!r.id) continue;
    const businessId = attributeAd(r, byPageId, ctx.businesses);
    if (!businessId) continue; // competitor-only ads live in AdMarketAdvertiser
    bizWithRealAd.add(businessId);
    result.adCount += 1;
    const data = {
      businessId,
      platform: "META" as const,
      advertiserName: r.pageName ?? null,
      pageId: r.pageId || null,
      adCreativeBody: r.adCreativeBody ?? null,
      linkTitle: r.linkTitle ?? null,
      linkCaption: r.linkCaption ?? null,
      ctaText: r.ctaText ?? null,
      displayFormat: r.displayFormat ?? null,
      previewImageUrl: r.imageUrl ?? null,
      landingUrl: r.linkUrl ?? null,
      platforms: r.platforms ?? [],
      collationCount: r.collationCount ?? null,
      startedAt: parseDateOrNull(r.startDate),
      endedAt: parseDateOrNull(r.endDate),
      isActive: r.isActive ?? true,
    };
    try {
      await prisma.adLibraryEntry.upsert({
        where: { externalAdId: r.id },
        create: {
          ...data,
          externalAdId: r.id,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: { ...data, lastSeenAt: now },
      });
      result.entriesUpserted += 1;
    } catch (e) {
      result.errors.push(`entry:${(e as Error).message}`.slice(0, 200));
    }
  }

  // 6b · FACET → AdLibraryEntry. Keyword/cell scans usually return ONLY the
  // advertiser facet (who advertises + an ad count) with NO per-creative rows —
  // so a business that DOES advertise gets no per-ad AdLibraryEntry above and
  // its per-business Meta signals (`has_active_meta_ads`, `meta_ad_count`,
  // `not_advertising`) stay wrong. For each facet advertiser whose pageId
  // matches a business's fbPageId, upsert ONE minimal placeholder AdLibraryEntry
  // so those signals fire. Skipped when the business already got a real per-ad
  // row this run (avoids double-counting activeCount). Synthetic externalAdId
  // `meta-facet:{pageId}` is stable → a re-run upserts the same row (and it's
  // superseded the moment real creatives land, keyed by the real ad id).
  for (const a of advertisers) {
    const pid = a.pageId || "";
    if (!pid) continue;
    const businessId = byPageId.get(pid);
    if (!businessId) continue; // competitor-only advertiser (market layer only)
    if (bizWithRealAd.has(businessId)) continue; // real rows already counted
    const active = a.adCount == null || a.adCount > 0; // facet present ⇒ active
    try {
      await prisma.adLibraryEntry.upsert({
        where: { externalAdId: `meta-facet:${pid}` },
        create: {
          externalAdId: `meta-facet:${pid}`,
          businessId,
          platform: "META" as const,
          advertiserName: a.pageName ?? null,
          pageId: pid,
          // Carry the facet's grouped ad count so downstream consumers that read
          // collationCount aren't blind to the true creative volume behind the
          // single placeholder row.
          collationCount: a.adCount ?? null,
          isActive: active,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          businessId,
          advertiserName: a.pageName ?? null,
          pageId: pid,
          collationCount: a.adCount ?? null,
          isActive: active,
          lastSeenAt: now,
        },
      });
      result.entriesUpserted += 1;
      if (active) result.adCount += 1;
    } catch (e) {
      result.errors.push(`facet-entry:${(e as Error).message}`.slice(0, 200));
    }
  }

  // 7 · telemetry run row (freshness marker + dashboard counts). Status is now
  // outcome-honest: OK only for a fully-verified run (ok/empty_verified) with no
  // persistence errors; PARTIAL when the actor reported `partial` (some targets
  // silently failed) OR a per-row persist errored. blocked/timeout/error never
  // reach here (returned FAILED above).
  // `salvaged` (an unverified-but-has-data run) and `pendingTargets` are BOTH
  // load-bearing PARTIAL triggers in their own right — never rely only on the
  // errors-array side effect (a future refactor filtering errors before here
  // would silently write a salvaged/incomplete run as OK and let the 30-day
  // gate cache an unverified result as verified · verifier hole).
  let runStatus: "OK" | "PARTIAL" | "FAILED" =
    outcome === "partial" ||
    salvaged ||
    pendingTargets > 0 ||
    result.errors.length > 0
      ? "PARTIAL"
      : "OK";

  // A4 (filters audit P0) · SOFT-BLOCK SUSPICION heuristic. An UNDETECTED Meta
  // soft-block (session gets pages but Meta withholds all data) surfaces as a
  // clean outcome with 0 advertisers — writing that as OK would let the 30-day
  // freshness gate serve the cached emptiness on every re-pay. Before locking
  // in a "verified-empty market" for a month, be conservative: with 0
  // advertisers AND 0 attributed ads, mark the run FAILED (the freshness gate
  // only anchors on OK/PARTIAL → the next purchase retries) when either
  //   (a) NO per-target status evidences the data query actually fired — the
  //       actor's un-zeroable primer/self-check taxonomy (R1): a verified
  //       target carries status ok/empty_verified or graphqlHits ≥ 1; an
  //       evidence-less "empty" is indistinguishable from a soft-block; or
  //   (b) a previous successful run for this cell recorded REAL advertisers —
  //       a known-advertiser market suddenly reading empty is a block, not a
  //       market collapse (and that prior run is >30d stale by definition, or
  //       the freshness gate would have served it).
  // Billing is untouched — the run already happened and was billed; only the
  // status (→ retryability) changes.
  if (result.advertiserCount === 0 && result.adCount === 0) {
    const sessionSawDataQuery = targetStatuses.some(
      (t) =>
        t.status === "ok" ||
        t.status === "empty_verified" ||
        (t.graphqlHits ?? 0) >= 1,
    );
    // (b) · a prior successful run with real advertisers for this cell,
    // bounded to 180d — without the window a market that GENUINELY collapsed
    // to zero advertisers could never re-anchor as verified-empty (every
    // future 0-run would read FAILED forever off one ancient positive run).
    const knownAdvertiserCell = await prisma.adMarketRun.findFirst({
      where: {
        cellKey,
        platform: "META",
        status: { in: ["OK", "PARTIAL"] },
        advertiserCount: { gt: 0 },
        ranAt: { gte: new Date(Date.now() - 180 * 86_400_000) },
      },
      orderBy: { ranAt: "desc" },
      select: { id: true, advertiserCount: true },
    });
    if (!sessionSawDataQuery || knownAdvertiserCell) {
      runStatus = "FAILED";
      result.errors.push(
        `meta-softblock-suspected:${
          !sessionSawDataQuery ? "no-verified-target" : ""
        }${
          !sessionSawDataQuery && knownAdvertiserCell ? "+" : ""
        }${knownAdvertiserCell ? `prior-advertisers-${knownAdvertiserCell.advertiserCount}` : ""}`,
      );
    }
  }

  await prisma.adMarketRun.create({
    data: {
      cellKey,
      platform: "META",
      status: runStatus,
      costUsd: result.costUsd,
      advertiserCount: result.advertiserCount,
      adCount: result.adCount,
      apifyRunId: result.runId,
      detailJson: metaDetailJson({
        ...detailBase,
        outcome,
        errors: result.errors,
      }),
    },
  });

  // R3 · per-outcome cost visibility — attribute block-vs-empty-vs-real spend.
  logMetaOutcome({
    cellKey,
    outcome,
    costUsd: result.costUsd,
    runId: result.runId,
    advertiserCount: result.advertiserCount,
    adCount: result.adCount,
  });

  result.outcome = "collected";
  return result;
}

/**
 * R3 · structured, single-line JSON log of a Meta cell run's outcome CLASS +
 * spend, so block-vs-empty-vs-real cost is attributable in Vercel logs (per
 * `.claude/rules/observability.md` — CronRun.meta has no per-cell field, so a
 * structured console line is the sanctioned surface). One event per run.
 */
function logMetaOutcome(o: {
  cellKey: string;
  outcome: MetaRunOutcome | "deferred";
  costUsd: number;
  runId: string | null;
  advertiserCount?: number;
  adCount?: number;
}): void {
  console.log(
    JSON.stringify({
      level: "info",
      event: "cell.meta.outcome",
      feature: "cell-intel",
      cellKey: o.cellKey,
      outcome: o.outcome,
      costUsd: Number(o.costUsd.toFixed(6)),
      runId: o.runId,
      advertisers: o.advertiserCount ?? 0,
      ads: o.adCount ?? 0,
      ts: new Date().toISOString(),
    }),
  );
}
