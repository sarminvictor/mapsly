// modules/discovery/enrich-lighthouse.ts · the DECOUPLED, optional Lighthouse
// enrichment orchestrator.
//
// Lighthouse is a SEPARATE enrichment from contacts. enrich-contacts.ts NEVER
// calls this — Lighthouse runs ONLY when a user (or a dedicated cron) explicitly
// invokes `enrichLighthouseForBusinesses`. Fetching a DOM for contacts must not
// silently trigger a $0.00425 (open) / $0.06 (walled) Lighthouse pass.
//
// Open vs walled routing (the cost story):
//   - OPEN site   → DataForSEO `lighthouseAudit` ($0.00425). Cheap, bulk-safe.
//   - WALLED site → the Apify actor's in-browser Lighthouse ($0.06 @ 4 GB,
//                   maxConcurrency 1). On Cloudflare sites DfS audits the
//                   CHALLENGE PAGE (403 / "blocked from indexing" / SEO≈40 +
//                   meta-refresh) → junk, so we pay for a real browser instead.
//                   Walled runs are HARD-CAPPED per invocation (it's expensive).
//
// MUST run inside an open CronRun: both `lighthouseAudit` (DfS, via the shared
// client) and `fetchLighthouse` (Apify) assert the cron context. The invariant
// is the "no live API in user request path" rule.
//
// Persistence: one LighthouseAudit row per business. The `formFactor` column
// records "mobile" (we always audit mobile); rawJson carries a source marker so
// the dashboard can tell a DfS audit from an actor audit and (for walled) flag
// that the cheap path would have returned junk.
//
// See:
//   - services/dataforseo/lighthouse.ts — the DfS audit (open sites)
//   - services/dom-fetcher/fetcher.ts — fetchLighthouse (walled sites)
//   - services/dom-fetcher/scale.ts — WALLED_LIGHTHOUSE_LIMIT, ceilings, freshness
//   - modules/discovery/enrich-contacts.ts — the SIBLING (contacts; never calls us)

import prisma from "@/lib/prisma";
import { getCurrentCronRun } from "@/lib/cost/cost-counter";
import {
  lighthouseAudit,
  type LighthouseAuditResult,
} from "@/services/dataforseo/lighthouse";
import {
  fetchLighthouse,
  type ActorLighthouse,
  LIGHTHOUSE_FRESHNESS_DAYS as SCALE_LIGHTHOUSE_FRESHNESS_DAYS,
  WALLED_LIGHTHOUSE_LIMIT as SCALE_WALLED_LIGHTHOUSE_LIMIT,
  LIGHTHOUSE_RUN_COST_CEILING_USD as SCALE_LIGHTHOUSE_CEILING_USD,
} from "@/services/dom-fetcher";
import { isFresh } from "@/modules/discovery/enrich-fresh";

/** Lighthouse audits are fresh for 30 days (services/dom-fetcher/scale.ts). */
const LIGHTHOUSE_FRESHNESS_DAYS = SCALE_LIGHTHOUSE_FRESHNESS_DAYS;
/** Hard cap on walled actor-Lighthouse runs per invocation (the $0.06 path). */
const WALLED_LIGHTHOUSE_LIMIT = SCALE_WALLED_LIGHTHOUSE_LIMIT;
/** Cumulative-cost ceiling (USD) for one invocation. */
const LIGHTHOUSE_RUN_COST_CEILING_USD = SCALE_LIGHTHOUSE_CEILING_USD;

/** How a given business's audit was sourced — persisted in rawJson.source. */
export type LighthouseSource = "dataforseo" | "actor";

/** Reachability hint we read off the Business row to pre-classify open/walled. */
type ReachabilityKnown = "open" | "walled" | "unknown";

/** Options for {@link enrichLighthouseForBusinesses}. */
export interface EnrichLighthouseOptions {
  /** Max businesses to attempt this invocation. Required — Lighthouse is paid. */
  limit?: number;
  /** Override the freshness window (days). Default 30. */
  freshnessDays?: number;
  /** Inject "now" for deterministic tests. Default new Date(). */
  now?: Date;
  /** Re-audit even fresh businesses (admin "force" path). Default false. */
  force?: boolean;
  /** Residential proxy country for the WALLED actor pass. Default "US". */
  country?: string;
  /** Override the per-invocation walled-actor cap. Default 10. */
  walledLimit?: number;
  /** Override the per-invocation cumulative-cost ceiling (USD). Default 2. */
  maxUsageUsd?: number;
}

/** What the orchestrator reports back to the caller / cron summary. */
export interface EnrichLighthouseResult {
  /** Businesses we attempted (excludes skippedFresh + skippedNoWebsite). */
  processed: number;
  /** Audits persisted via the cheap DataForSEO path (open sites). */
  openAudited: number;
  /** Audits persisted via the actor path (walled sites). */
  walledAudited: number;
  /** Businesses skipped because their latest audit is still fresh. */
  skippedFresh: number;
  /** Businesses skipped because they have no website. */
  skippedNoWebsite: number;
  /** Walled businesses skipped because the per-invocation cap was reached. */
  skippedWalledOverCap: number;
  /** Businesses skipped because the cost ceiling was reached. */
  skippedOverBudget: number;
  /** Businesses that threw during audit/persist (isolated, batch continued). */
  failed: number;
  /** Apify USD billed for the walled passes (also added to CronRun.costUsd). */
  usageTotalUsd: number;
}

/** The subset of Business columns the orchestrator reads — explicit select. */
interface BusinessForLighthouse {
  id: string;
  website: string | null;
  contactScanStatus: string;
  reachability: string;
}

/**
 * Audit a set of businesses' Lighthouse scores, routing each to the cheap
 * DataForSEO path (open sites) or the expensive actor path (Cloudflare-walled).
 * MUST run inside an open CronRun. Failures isolate per-business. Walled actor
 * runs are HARD-CAPPED (walledLimit) AND bounded by a cumulative cost ceiling.
 */
export async function enrichLighthouseForBusinesses(
  businessIds: string[],
  opts: EnrichLighthouseOptions = {},
): Promise<EnrichLighthouseResult> {
  if (!getCurrentCronRun()) {
    throw new Error(
      `[enrichLighthouseForBusinesses] called outside an open CronRun. ` +
        `Run inside withCronRun(...) — see .claude/rules/cost-discipline.md.`,
    );
  }

  const now = opts.now ?? new Date();
  const freshnessDays = opts.freshnessDays ?? LIGHTHOUSE_FRESHNESS_DAYS;
  const walledCap = opts.walledLimit ?? WALLED_LIGHTHOUSE_LIMIT;
  const ceiling = opts.maxUsageUsd ?? LIGHTHOUSE_RUN_COST_CEILING_USD;
  const limit = opts.limit ?? businessIds.length;

  const empty: EnrichLighthouseResult = {
    processed: 0,
    openAudited: 0,
    walledAudited: 0,
    skippedFresh: 0,
    skippedNoWebsite: 0,
    skippedWalledOverCap: 0,
    skippedOverBudget: 0,
    failed: 0,
    usageTotalUsd: 0,
  };
  if (businessIds.length === 0 || limit <= 0) return empty;

  const businesses = (await prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: {
      id: true,
      website: true,
      contactScanStatus: true,
      reachability: true,
    },
  })) as BusinessForLighthouse[];

  // Latest audit timestamp per business — one query for the whole batch (avoids
  // an N+1 freshness probe). A business absent from the map has never been
  // audited (not fresh).
  const lastAuditByBusiness = await loadLastAudit(businessIds);

  // ── Pre-flight: filter to auditable, non-fresh, has-website businesses ──────
  let skippedFresh = 0;
  let skippedNoWebsite = 0;
  const targets: { business: BusinessForLighthouse; url: string }[] = [];
  for (const b of businesses) {
    const website = (b.website ?? "").trim();
    if (!website) {
      skippedNoWebsite += 1;
      continue;
    }
    if (
      !opts.force &&
      isFresh(lastAuditByBusiness.get(b.id) ?? null, freshnessDays, now)
    ) {
      skippedFresh += 1;
      continue;
    }
    targets.push({ business: b, url: homepageUrl(website) });
    if (targets.length >= limit) break;
  }

  if (targets.length === 0) {
    return { ...empty, skippedFresh, skippedNoWebsite };
  }

  // ── Audit per business · isolate failures ───────────────────────────────────
  let openAudited = 0;
  let walledAudited = 0;
  let walledUsed = 0;
  let skippedWalledOverCap = 0;
  let skippedOverBudget = 0;
  let failed = 0;
  let usageTotalUsd = 0;

  for (const { business, url } of targets) {
    try {
      // Stop spending once the cumulative ceiling is hit — never silently.
      if (usageTotalUsd >= ceiling) {
        console.log(
          JSON.stringify({
            level: "warn",
            event: "cost-ceiling.hit",
            operation: "enrich-lighthouse",
            ceilingUsd: ceiling,
            usageTotalUsd,
          }),
        );
        skippedOverBudget += 1;
        continue;
      }

      const known = classifyKnown(business);

      // OPEN (known or to-be-probed) → cheap DfS audit first.
      if (known !== "walled") {
        const dfs = await lighthouseAudit({ url, for_mobile: true });
        if (!isChallengeResult(dfs)) {
          await persistDfsAudit(business.id, dfs, now);
          openAudited += 1;
          continue;
        }
        // The DfS audit hit a Cloudflare challenge → this site is WALLED.
        // Fall through to the actor path (subject to the cap below).
      }

      // WALLED → expensive actor Lighthouse, hard-capped per invocation.
      if (walledUsed >= walledCap) {
        skippedWalledOverCap += 1;
        continue;
      }
      walledUsed += 1;
      const actor = await fetchLighthouse(
        url,
        opts.country != null ? { country: opts.country } : {},
      );
      usageTotalUsd += actor.usageTotalUsd;
      if (actor.lighthouse && actor.lighthouse.ok) {
        await persistActorAudit(business.id, actor.lighthouse, now);
        walledAudited += 1;
      } else {
        // The actor couldn't produce a usable audit either — count as failed
        // (we paid for the run; usageTotalUsd already reflects it).
        failed += 1;
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "enrich-lighthouse.business.failed",
          businessId: business.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      failed += 1;
    }
  }

  return {
    processed: targets.length,
    openAudited,
    walledAudited,
    skippedFresh,
    skippedNoWebsite,
    skippedWalledOverCap,
    skippedOverBudget,
    failed,
    usageTotalUsd,
  };
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Pre-classify a business as open/walled/unknown from its STORED contact signal,
 * to skip the cheap DfS probe when we already know the site is walled. A FAILED
 * contact scan is the strongest "walled" signal we keep (the DOM-fetcher couldn't
 * clear Cloudflare); an OK scan means a plain fetch worked → open. Anything else
 * is unknown → we probe with the cheap DfS audit and detect the challenge live.
 */
function classifyKnown(b: BusinessForLighthouse): ReachabilityKnown {
  if (b.contactScanStatus === "FAILED") return "walled";
  if (b.contactScanStatus === "OK") return "open";
  return "unknown";
}

/**
 * Detect the Cloudflare-challenge signature in a DataForSEO Lighthouse result.
 * On a walled site DfS audits the challenge page, which is recognizable by:
 *   - the page returns an unsuccessful HTTP status (the `http-status-code` audit
 *     fails, or our extracted status is 403/503), OR
 *   - the page is "blocked from indexing" (`is-crawlable` audit fails / score 0),
 *     OR
 *   - SEO ≈ 40 (the challenge page scores ~40 on SEO) AND a `meta-refresh` audit
 *     is present (the challenge redirects via meta-refresh).
 * PURE + exported for tests.
 */
export function isChallengeResult(r: LighthouseAuditResult): boolean {
  const audits = readAudits(r.raw);

  // 1 · Unsuccessful HTTP status (Cloudflare returns 403 on the challenge).
  const httpStatus = audits["http-status-code"];
  if (httpStatus != null && httpStatus.score === 0) return true;

  // 2 · Blocked from indexing (the challenge page sets noindex / is uncrawlable).
  const crawlable = audits["is-crawlable"];
  if (crawlable != null && crawlable.score === 0) return true;

  // 3 · The tell-tale SEO≈40 + meta-refresh combination.
  const hasMetaRefresh = audits["meta-refresh"] != null;
  if (
    hasMetaRefresh &&
    r.seo != null &&
    r.seo >= 35 &&
    r.seo <= 45 &&
    // A genuinely fine site doesn't pair a ~40 SEO with a meta-refresh; the
    // challenge does. Guard with a low performance signal too (challenge pages
    // are near-empty → either very high or null perf; we don't gate on perf to
    // avoid false negatives, the meta-refresh + SEO band is specific enough).
    true
  ) {
    return true;
  }

  return false;
}

/** Minimal audit shape we read from the raw LHR for challenge detection. */
interface RawAudit {
  score?: number | null;
}

/** Pull the `audits` record off the raw LHR blob, tolerant of shape drift. */
function readAudits(raw: unknown): Record<string, RawAudit> {
  if (raw == null || typeof raw !== "object") return {};
  const a = (raw as { audits?: unknown }).audits;
  if (a == null || typeof a !== "object") return {};
  return a as Record<string, RawAudit>;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/** Round ms → seconds (3 dp) for the LighthouseAudit lcp/fcp columns (seconds). */
function msToSeconds(ms: number | null): number | null {
  return ms == null ? null : Number((ms / 1000).toFixed(3));
}

/** Persist an OPEN-site DataForSEO audit to a LighthouseAudit row. */
async function persistDfsAudit(
  businessId: string,
  dfs: LighthouseAuditResult,
  now: Date,
): Promise<void> {
  await prisma.lighthouseAudit.create({
    data: {
      businessId,
      auditedAt: now,
      performance: dfs.performance,
      accessibility: dfs.accessibility,
      bestPractices: dfs.bestPractices,
      seo: dfs.seo,
      pwa: dfs.pwa,
      lcp: msToSeconds(dfs.lcpMs),
      cls: dfs.cls,
      // INP isn't reported by lab Lighthouse — TBT is the documented proxy.
      inp: dfs.tbtMs,
      fcp: msToSeconds(dfs.fcpMs),
      tbt: dfs.tbtMs,
      formFactor: "mobile",
      techSource: "dataforseo",
      // LighthouseAudit has no rawJson column — the provenance marker lives in
      // the diagnostics Json column ({ source, walled }).
      diagnostics: sourceMeta("dataforseo", false),
    },
  });
}

/** Persist a WALLED-site actor Lighthouse audit to a LighthouseAudit row. */
async function persistActorAudit(
  businessId: string,
  lh: ActorLighthouse,
  now: Date,
): Promise<void> {
  await prisma.lighthouseAudit.create({
    data: {
      businessId,
      auditedAt: now,
      performance: lh.performance,
      accessibility: lh.accessibility,
      bestPractices: lh.bestPractices,
      seo: lh.seo,
      lcp: msToSeconds(lh.lcpMs),
      cls: lh.cls,
      inp: lh.tbtMs,
      fcp: msToSeconds(lh.fcpMs),
      tbt: lh.tbtMs,
      formFactor: "mobile",
      techSource: "actor",
      // walled:true records that the cheap DfS path would have returned the
      // Cloudflare challenge page (junk) — this audit came from a real browser.
      // Stored in diagnostics (LighthouseAudit has no rawJson column).
      diagnostics: sourceMeta("actor", true),
    },
  });
}

/** A small JSON marker stored in LighthouseAudit.rawJson to record provenance. */
function sourceMeta(
  source: LighthouseSource,
  walled: boolean,
): {
  source: LighthouseSource;
  walled: boolean;
} {
  return { source, walled };
}

// ─── DB glue ──────────────────────────────────────────────────────────────────

/** Latest LighthouseAudit.auditedAt per business, in one grouped query. */
async function loadLastAudit(
  businessIds: readonly string[],
): Promise<Map<string, Date>> {
  const rows = await prisma.lighthouseAudit.groupBy({
    by: ["businessId"],
    where: { businessId: { in: [...businessIds] } },
    _max: { auditedAt: true },
  });
  const out = new Map<string, Date>();
  for (const r of rows) {
    if (r._max.auditedAt) out.set(r.businessId, r._max.auditedAt);
  }
  return out;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Coerce a (possibly bare) website value into a fetchable absolute https URL. */
function homepageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  return "https://" + trimmed;
}

export const __test = {
  LIGHTHOUSE_FRESHNESS_DAYS,
  WALLED_LIGHTHOUSE_LIMIT,
  LIGHTHOUSE_RUN_COST_CEILING_USD,
  classifyKnown,
  isChallengeResult,
  homepageUrl,
};
