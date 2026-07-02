// services/lighthouse/audit.ts · composer that joins DataForSEO Lighthouse
// + Mapsly's custom DOM checks into a single audit result.
//
// What this module owns:
//   - Orchestrating the two underlying calls (DataForSEO `lighthouseAudit`
//     + an HTML fetch for DOM scanning).
//   - HTML fetch transport (timeout, retry, User-Agent) and a typed error
//     class for downstream triage.
//   - Mapping the combined result to the LighthouseAudit Prisma model
//     shape — every column produced here corresponds 1:1 to a column on
//     that model (except `business`/`businessId` which the caller sets
//     when persisting).
//   - Cost discipline (withCostCounter wrap + zero-cost DOM op) and KV
//     dedup (kvCache 24h).
//
// What this module does NOT own:
//   - Persistence (the cron handler in app/api/cron/weekly/lighthouse-audit
//     reads the result and writes the row).
//   - Per-business orchestration (which businesses to audit, in what
//     order, with what retry budget — that's the cron job).
//   - Tech-stack detection (Wappalyzer fingerprinting). Tracked separately
//     in PLAN follow-ups; the LighthouseAudit.techStack column starts
//     empty and gets backfilled in a future pass.
//
// Cost ceiling per call: DataForSEO Lighthouse ($0.0025) + HTML fetch ($0) =
// $0.0025. Well under the $5 hard ceiling per `cost-discipline.md`.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import prisma from "@/lib/prisma";
import { withCostCounter } from "@/lib/cost/cost-counter";
// WP8-1: the DOM leg fetches the business's own website from our egress —
// guard both the initial URL and the post-redirect final URL against
// private/loopback/link-local/metadata ranges (incl. DNS rebinding). A blocked
// URL throws SsrfBlockedError, which the retry loop surfaces as a non-retryable
// LighthouseHtmlFetchError (same shape callers already handle).
import { assertPublicUrl, SsrfBlockedError } from "@/lib/net/ssrf-guard";
import {
  lighthouseAuditUncached,
  type LighthouseAuditResult as DataForSeoLighthouseResult,
} from "@/services/dataforseo/lighthouse";
import {
  runDomChecks,
  type DomChecksResult,
  type NapInput,
} from "./dom-checks";
import {
  extractOpportunities,
  type LighthouseResult as RawLighthouseResult,
} from "./extract-opportunities";
import { LIGHTHOUSE_UNIT_COST_USD } from "./pricing";

// ---- Constants ----------------------------------------------------------

const HTML_FETCH_OPERATION = "lighthouse.dom-fetch";
const FULL_AUDIT_OPERATION = "lighthouse.full-audit";

/** Crawler User-Agent. Identifies Mapsly so a site operator can find us in
 *  their logs and contact us; honors robots.txt convention of declaring a
 *  named bot rather than masquerading as a real browser. */
const DEFAULT_USER_AGENT =
  "Mapsly-Audit/1.0 (+https://mapsly.ai/about/crawler)";

/** Per-call timeout for the HTML fetch. The DataForSEO Lighthouse audit
 *  side already takes 10-40s — the HTML fetch is a single round-trip
 *  against a typical CDN-fronted page, 10s is more than enough. */
const HTML_FETCH_TIMEOUT_MS = 10_000;

/** Retry budget for the HTML fetch. 1 retry on transient network/5xx,
 *  exponential backoff. Less aggressive than the DataForSEO retry budget
 *  (which is 2) because (a) we don't pay for HTML fetches so wasting one
 *  isn't free of opportunity cost, and (b) the cron job re-runs weekly,
 *  so a transient failure heals on its own. */
const HTML_FETCH_RETRIES = 1;
const HTML_RETRY_BASE_DELAY_MS = 400;
const HTML_RETRY_MAX_DELAY_MS = 2_000;

/** Cap on the response body we'll parse. 1.5 MB is generous for HTML; we
 *  truncate beyond this to avoid runaway parses on accidentally large
 *  responses. Lighthouse uses ~1 MB as its own internal cap. */
const MAX_HTML_BYTES = 1_500_000;

// ---- Test seams ---------------------------------------------------------

let _fetchOverride: typeof fetch | null = null;
let _sleepOverride: ((ms: number) => Promise<void>) | null = null;

/** Replace `globalThis.fetch` inside this module. Pass `null` to restore. */
export function __setFetchForTesting(fn: typeof fetch | null): void {
  _fetchOverride = fn;
}

/** Replace the inter-retry sleep so tests don't wait real backoff windows.
 *  Pass `null` to restore. */
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

// ---- Schemas ------------------------------------------------------------

export const LighthouseFullAuditInputSchema = z.object({
  /** URL to audit. Used for both the DataForSEO call and the HTML fetch. */
  url: z.string().url(),
  /** Mobile preset toggle. Defaults true per `.claude/rules/performance.md`. */
  for_mobile: z.boolean().default(true),
  /** Optional NAP triplet for `napConsistent`. Pass when auditing a
   *  business whose canonical NAP we already know — typically every cron
   *  audit. Omit for ad-hoc URL audits. */
  nap: z
    .object({
      name: z.string().min(1),
      address: z.string().min(1),
      phone: z.string().min(1),
    })
    .partial()
    .optional(),
});
export type LighthouseFullAuditInput = z.input<
  typeof LighthouseFullAuditInputSchema
>;

// ---- Errors -------------------------------------------------------------

/** Thrown when the HTML fetch leg fails irrecoverably. The Lighthouse
 *  audit may still have succeeded — callers can choose to persist a
 *  partial result if the LH side worked. */
export class LighthouseHtmlFetchError extends Error {
  readonly url: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;

  constructor(opts: {
    url: string;
    message: string;
    httpStatus?: number;
    retryable?: boolean;
  }) {
    super(`[lighthouse.dom-fetch] ${opts.url}: ${opts.message}`);
    this.name = "LighthouseHtmlFetchError";
    this.url = opts.url;
    this.httpStatus = opts.httpStatus;
    this.retryable = opts.retryable ?? false;
  }
}

// ---- HTML fetch ---------------------------------------------------------

interface HtmlFetchResult {
  html: string;
  finalUrl: string;
  httpStatus: number;
  /** True when the response body exceeded MAX_HTML_BYTES and was sliced. */
  truncated: boolean;
}

async function fetchHtmlRaw(url: string): Promise<HtmlFetchResult> {
  const fetchImpl = getFetch();
  const sleep = getSleep();

  // WP8-1: reject the initial URL up front if its host (or any resolved
  // address) is private/reserved. Non-retryable — a bad target won't get
  // better on retry.
  try {
    await assertPublicUrl(url);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw new LighthouseHtmlFetchError({
        url,
        message: err.message,
        retryable: false,
      });
    }
    throw err;
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= HTML_FETCH_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(new Error("html-fetch timeout")),
        HTML_FETCH_TIMEOUT_MS,
      );
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "GET",
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "follow",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) {
        const retryable =
          res.status >= 500 || res.status === 408 || res.status === 429;
        const err = new LighthouseHtmlFetchError({
          url,
          message: `http ${res.status}`,
          httpStatus: res.status,
          retryable,
        });
        if (!retryable || attempt === HTML_FETCH_RETRIES) throw err;
        lastError = err;
      } else {
        // WP8-1: `redirect: "follow"` means fetch already chased any redirect;
        // re-validate the FINAL URL so a public site that 30x-redirects to a
        // private/metadata host is rejected before we read/return its body.
        const finalUrl = res.url || url;
        if (finalUrl !== url) {
          try {
            await assertPublicUrl(finalUrl);
          } catch (err) {
            if (err instanceof SsrfBlockedError) {
              throw new LighthouseHtmlFetchError({
                url: finalUrl,
                message: err.message,
                retryable: false,
              });
            }
            throw err;
          }
        }
        const text = await res.text();
        const truncated = text.length > MAX_HTML_BYTES;
        return {
          html: truncated ? text.slice(0, MAX_HTML_BYTES) : text,
          finalUrl,
          httpStatus: res.status,
          truncated,
        };
      }
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof LighthouseHtmlFetchError ? err.retryable : true; // network errors are retryable
      if (!retryable || attempt === HTML_FETCH_RETRIES) {
        if (err instanceof LighthouseHtmlFetchError) throw err;
        throw new LighthouseHtmlFetchError({
          url,
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        });
      }
    }
    const delay = Math.min(
      HTML_RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
      HTML_RETRY_MAX_DELAY_MS,
    );
    await sleep(delay);
  }
  // Defensive — unreachable because each loop iteration either returns or
  // throws on its final pass.
  throw lastError instanceof Error
    ? lastError
    : new LighthouseHtmlFetchError({
        url,
        message: "exhausted retries with no error",
        retryable: false,
      });
}

/** Public uncached HTML fetcher · withCostCounter wrap requires an open
 *  CronRun. Cost = $0 (we self-host); the wrap exists to enforce the
 *  "no live API in user path" invariant uniformly. */
export const lighthouseDomFetchUncached = withCostCounter(
  HTML_FETCH_OPERATION,
  LIGHTHOUSE_UNIT_COST_USD.domChecks,
  fetchHtmlRaw,
);

// ---- Combined audit -----------------------------------------------------

export interface LighthouseFullAuditResult {
  url: string;
  /** Final URL after redirects (from the HTML fetch leg). May differ
   *  from input URL if the site redirected; useful when persisting. */
  finalUrl: string;
  /** DataForSEO scores + CWV. */
  scores: DataForSeoLighthouseResult;
  /** Custom DOM check verdicts. */
  domChecks: DomChecksResult;
  /** True when at least one leg fell back to a partial result. */
  partial: boolean;
  /** Per-leg outcome — useful for downstream telemetry. */
  legs: {
    lighthouseOk: boolean;
    domOk: boolean;
    lighthouseError?: string;
    domError?: string;
  };
  operation: string;
}

async function lighthouseFullAuditRaw(
  input: LighthouseFullAuditInput,
): Promise<LighthouseFullAuditResult> {
  const parsed = LighthouseFullAuditInputSchema.parse(input);
  // Run both legs in parallel — they're independent network calls.
  // Promise.allSettled so a failure in one doesn't poison the other.
  const [lhResult, domResult] = await Promise.allSettled([
    lighthouseAuditUncached({
      url: parsed.url,
      for_mobile: parsed.for_mobile,
    }),
    lighthouseDomFetchUncached(parsed.url),
  ]);

  const lighthouseOk = lhResult.status === "fulfilled";
  const domOk = domResult.status === "fulfilled";

  if (!lighthouseOk && !domOk) {
    // Both legs failed — surface the LH error since it's the more
    // expensive one and the more likely root cause. Attach the DOM
    // error via `cause` so triage can see both stacks.
    const lhReason = lhResult.status === "rejected" ? lhResult.reason : null;
    const domReason = domResult.status === "rejected" ? domResult.reason : null;
    const primary =
      lhReason instanceof Error
        ? lhReason
        : new Error(
            lhReason != null ? String(lhReason) : "both audit legs failed",
          );
    if (domReason && !primary.cause) {
      try {
        Object.defineProperty(primary, "cause", {
          value: domReason,
          configurable: true,
          writable: true,
        });
      } catch {
        // Older runtimes that don't allow setting .cause — ignore.
      }
    }
    throw primary;
  }

  // Build the scores leg. If DataForSEO failed, fall back to an empty
  // shape so downstream persistence has the columns it needs (every
  // numeric field becomes null).
  const scores: DataForSeoLighthouseResult =
    lhResult.status === "fulfilled"
      ? lhResult.value
      : emptyScoresFor(parsed.url);

  // Build the DOM checks leg.
  let domChecks: DomChecksResult;
  let finalUrl = parsed.url;
  if (domResult.status === "fulfilled") {
    finalUrl = domResult.value.finalUrl;
    domChecks = runDomChecks({
      html: domResult.value.html,
      nap: parsed.nap as Partial<NapInput> | undefined,
    });
  } else {
    // DOM fetch failed — every DOM-derived signal is unknown.
    domChecks = {
      hasLocalBusinessSchema: false,
      hasFaqSchema: false,
      hasPhoneAboveFold: false,
      hasBookingCtaAboveFold: false,
      napConsistent: null,
      contentWithoutJs: false,
    };
  }

  return {
    url: parsed.url,
    finalUrl,
    scores,
    domChecks,
    partial: !lighthouseOk || !domOk,
    legs: {
      lighthouseOk,
      domOk,
      lighthouseError: lighthouseOk
        ? undefined
        : describeError(
            lhResult.status === "rejected" ? lhResult.reason : null,
          ),
      domError: domOk
        ? undefined
        : describeError(
            domResult.status === "rejected" ? domResult.reason : null,
          ),
    },
    operation: FULL_AUDIT_OPERATION,
  };
}

/** withCostCounter wrap with cost = 0 (the inner legs already bill); this
 *  wrap exists so the user-path enforcement applies even to callers that
 *  use the full-audit composer without thinking about its internals. */
export const lighthouseFullAuditUncached = withCostCounter(
  FULL_AUDIT_OPERATION,
  0,
  lighthouseFullAuditRaw,
);

/** Public, cached entry point. 24h KV dedup — same URL + same mobile
 *  flag within 24h returns the cached payload. NAP changes do NOT bust
 *  the cache because the NAP comparison happens on parsed text from
 *  the same source HTML; if a business changes their NAP we'll see it
 *  on the next 24h refresh anyway. */
export const lighthouseFullAudit = kvCache(
  "lighthouse:full-audit",
  { ttl: 24 * 60 * 60, tag: "lighthouse:full-audit" },
  lighthouseFullAuditUncached,
);

// ---- Persistence helpers ------------------------------------------------

/**
 * Convert a LighthouseFullAuditResult into the shape required for
 * `prisma.lighthouseAudit.create({ data: ... })`. Caller supplies the
 * `businessId` foreign key. Every column on the LighthouseAudit model
 * is mapped 1:1; null when unknown.
 *
 * `auditedAt` is left to default to now() on insert.
 * `rawJson` (the full Lighthouse payload) is included as an opaque
 * `unknown` so the caller can pass it through to Prisma's JSON column.
 */
export interface LighthouseAuditPersistRow {
  businessId: string;
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  pwa: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  fcp: number | null;
  tbt: number | null;
  ttfb: number | null;
  totalBytes: number | null;
  hasLocalBusinessSchema: boolean | null;
  hasFaqSchema: boolean | null;
  hasBookingCtaAboveFold: boolean | null;
  hasPhoneAboveFold: boolean | null;
  napConsistent: boolean | null;
  contentWithoutJs: boolean | null;
  techStack: string[];
  rawJson: unknown;
}

export function toPersistRow(
  result: LighthouseFullAuditResult,
  businessId: string,
): LighthouseAuditPersistRow {
  // LCP/FCP from DataForSEO come in milliseconds; the Prisma column is
  // documented as "seconds" — convert and round to 3 decimals.
  return {
    businessId,
    performance: result.scores.performance,
    accessibility: result.scores.accessibility,
    bestPractices: result.scores.bestPractices,
    seo: result.scores.seo,
    pwa: result.scores.pwa,
    lcp: msToSeconds(result.scores.lcpMs),
    cls: result.scores.cls,
    // INP is a FIELD metric that lab Lighthouse cannot measure. We used to
    // persist TBT here as a proxy, which silently let INP-named signals trust a
    // different metric. Leave it null until real field data lands (the planned
    // Sentry browser-SDK RUM, observability.md §RUM); the true lab TBT is still
    // stored in the `tbt` column below.
    inp: null,
    fcp: msToSeconds(result.scores.fcpMs),
    tbt: result.scores.tbtMs,
    ttfb: null,
    totalBytes: null,
    hasLocalBusinessSchema: result.legs.domOk
      ? result.domChecks.hasLocalBusinessSchema
      : null,
    hasFaqSchema: result.legs.domOk ? result.domChecks.hasFaqSchema : null,
    hasBookingCtaAboveFold: result.legs.domOk
      ? result.domChecks.hasBookingCtaAboveFold
      : null,
    hasPhoneAboveFold: result.legs.domOk
      ? result.domChecks.hasPhoneAboveFold
      : null,
    napConsistent: result.domChecks.napConsistent,
    contentWithoutJs: result.legs.domOk
      ? result.domChecks.contentWithoutJs
      : null,
    techStack: [],
    rawJson: result.legs.lighthouseOk ? (result.scores.raw ?? null) : null,
  };
}

// ---- Opportunity mining + persistence -----------------------------------

/** Extra desktop-preset columns the collector layers onto the create. */
export interface LighthouseDesktopExtras {
  desktopPerformance?: number | null;
  desktopLcp?: number | null;
  desktopInp?: number | null;
  desktopCls?: number | null;
}

/** What `persistLighthouseAudit` reports back. */
export interface PersistLighthouseResult {
  /** The created LighthouseAudit row id. */
  auditId: string;
  /** Number of LighthouseOpportunity rows created. */
  opportunitiesCreated: number;
}

/**
 * Persist a full audit result + mine the discarded ~95% of the Lighthouse blob
 * for pitchable wins. ONE additive flow on top of the existing column mapping:
 *
 *   1. `toPersistRow` maps the scores + DOM checks (existing behavior).
 *   2. `extractOpportunities(rawJson)` mines the failing audits → rollups
 *      (perfSavingsMs, a11yViolationCount, a11yCriticalCount, isOnHttps,
 *      hasVulnerableLibrary, formFactor) + per-audit Opportunity rows.
 *   3. Create the LighthouseAudit row with scores + rollups (rawJson stripped —
 *      the model has no column for it).
 *   4. Create one LighthouseOpportunity row per mined opportunity.
 *
 * The opportunity mining is best-effort: if the raw blob is missing or
 * unparseable, the audit row is still created (rollups null, no opportunities).
 * MUST run inside an open CronRun (the audit that produced `result` already did).
 */
export async function persistLighthouseAudit(
  result: LighthouseFullAuditResult,
  businessId: string,
  desktop: LighthouseDesktopExtras = {},
): Promise<PersistLighthouseResult> {
  const { rawJson, ...row } = toPersistRow(result, businessId);

  // Mine the raw blob for opportunities + rollups. Only attempt when the
  // Lighthouse leg succeeded AND a raw object is present.
  const raw =
    result.legs.lighthouseOk && rawJson != null
      ? (rawJson as RawLighthouseResult)
      : null;
  const mined = raw ? extractOpportunities(raw) : null;

  const created = await prisma.lighthouseAudit.create({
    data: {
      ...row,
      ...desktop,
      ...(mined
        ? {
            perfSavingsMs: mined.rollups.perfSavingsMs,
            a11yViolationCount: mined.rollups.a11yViolationCount,
            a11yCriticalCount: mined.rollups.a11yCriticalCount,
            isOnHttps: mined.rollups.isOnHttps,
            hasVulnerableLibrary: mined.rollups.hasVulnerableLibrary,
            formFactor: mined.rollups.formFactor,
          }
        : {}),
    },
    select: { id: true },
  });

  let opportunitiesCreated = 0;
  if (mined && mined.opportunities.length > 0) {
    await prisma.lighthouseOpportunity.createMany({
      data: mined.opportunities.map((o) => ({
        lighthouseAuditId: created.id,
        businessId,
        bucket: o.bucket,
        auditKey: o.auditKey,
        score: o.score,
        savingsMs: o.savingsMs,
        savingsBytes: o.savingsBytes,
        displayValue: o.displayValue,
        itemCount: o.itemCount,
      })),
    });
    opportunitiesCreated = mined.opportunities.length;
  }

  return { auditId: created.id, opportunitiesCreated };
}

// ---- Internals ----------------------------------------------------------

function emptyScoresFor(url: string): DataForSeoLighthouseResult {
  return {
    url,
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    pwa: null,
    lcpMs: null,
    cls: null,
    tbtMs: null,
    fcpMs: null,
    raw: {},
    operation: "dataforseo.lighthouse.audit",
  };
}

function msToSeconds(ms: number | null): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.round((ms / 1000) * 1000) / 1000;
}

function describeError(err: unknown): string {
  if (err == null) return "unknown";
  if (err instanceof Error) return err.message;
  return String(err);
}
