// services/lighthouse/extract-opportunities.ts · mine the full Lighthouse JSON
// (Phase 6/4.13). We already pay $0.0025 for the whole ~1MB report and keep
// only 5 scores; this extracts the FAILING audits as pitchable "fixable wins"
// (speed / ADA-a11y / security / mobile-SEO / third-party) + headline rollups.
// Pure over the Lighthouse result shape; no network.

export type OpportunityBucket =
  | "speed"
  | "a11y"
  | "security"
  | "mobile_seo"
  | "third_party";

export interface Opportunity {
  auditKey: string;
  bucket: OpportunityBucket;
  score: number | null;
  savingsMs: number | null;
  savingsBytes: number | null;
  displayValue: string | null;
  itemCount: number | null;
}

export interface LighthouseRollups {
  perfSavingsMs: number;
  a11yViolationCount: number;
  a11yCriticalCount: number;
  isOnHttps: boolean | null;
  hasVulnerableLibrary: boolean | null;
  formFactor: string | null;
}

export interface ExtractResult {
  opportunities: Opportunity[];
  rollups: LighthouseRollups;
}

interface LhAudit {
  id?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  numericValue?: number;
  displayValue?: string;
  details?: {
    items?: unknown[];
    overallSavingsMs?: number;
    overallSavingsBytes?: number;
  };
  metricSavings?: { LCP?: number; FCP?: number; TBT?: number; CLS?: number };
}

export interface LighthouseResult {
  audits?: Record<string, LhAudit>;
  configSettings?: { formFactor?: string };
}

const BUCKETS: Record<OpportunityBucket, string[]> = {
  speed: [
    "render-blocking-resources",
    "uses-optimized-images",
    "modern-image-formats",
    "unused-css-rules",
    "unused-javascript",
    "uses-text-compression",
    "server-response-time",
    "font-display",
    "uses-responsive-images",
  ],
  a11y: [
    "image-alt",
    "label",
    "link-name",
    "button-name",
    "color-contrast",
    "meta-viewport",
  ],
  security: ["is-on-https", "no-vulnerable-libraries", "errors-in-console"],
  mobile_seo: [
    "viewport",
    "tap-targets",
    "crawlable-anchors",
    "structured-data",
  ],
  third_party: ["third-party-summary", "dom-size", "bootup-time"],
};

/** Serious a11y audits whose failures drive ADA-lawsuit risk (vs. minor). */
const SERIOUS_A11Y = new Set([
  "image-alt",
  "label",
  "link-name",
  "button-name",
  "color-contrast",
  "meta-viewport",
]);

function bucketFor(auditKey: string): OpportunityBucket | null {
  for (const [bucket, keys] of Object.entries(BUCKETS)) {
    if (keys.includes(auditKey)) return bucket as OpportunityBucket;
  }
  return null;
}

/** A failing/under-par audit worth pitching. */
function isFixable(a: LhAudit): boolean {
  if (a.score == null) return false;
  if (a.scoreDisplayMode && !["binary", "numeric"].includes(a.scoreDisplayMode))
    return false;
  return a.score < 0.9;
}

function savingsMsOf(a: LhAudit): number | null {
  const m = a.metricSavings;
  const fromMetric = (m?.LCP ?? 0) + (m?.FCP ?? 0);
  if (fromMetric > 0) return Math.round(fromMetric);
  if (a.details?.overallSavingsMs)
    return Math.round(a.details.overallSavingsMs);
  return null;
}

/** Extract pitchable opportunities + headline rollups from a Lighthouse JSON. */
export function extractOpportunities(lhr: LighthouseResult): ExtractResult {
  const audits = lhr.audits ?? {};
  const opportunities: Opportunity[] = [];

  let perfSavingsMs = 0;
  let a11yViolationCount = 0;
  let a11yCriticalCount = 0;

  for (const [key, audit] of Object.entries(audits)) {
    const bucket = bucketFor(key);
    if (!bucket) continue;
    if (!isFixable(audit)) continue;

    const savingsMs = savingsMsOf(audit);
    const itemCount = audit.details?.items?.length ?? null;
    opportunities.push({
      auditKey: key,
      bucket,
      score: audit.score ?? null,
      savingsMs,
      savingsBytes: audit.details?.overallSavingsBytes ?? null,
      displayValue: audit.displayValue ?? null,
      itemCount,
    });

    if (bucket === "speed" && savingsMs) perfSavingsMs += savingsMs;
    if (bucket === "a11y" && SERIOUS_A11Y.has(key)) {
      a11yViolationCount += 1;
      if ((itemCount ?? 0) >= 5) a11yCriticalCount += 1;
    }
  }

  const httpsAudit = audits["is-on-https"];
  const vulnAudit = audits["no-vulnerable-libraries"];

  return {
    opportunities,
    rollups: {
      perfSavingsMs,
      a11yViolationCount,
      a11yCriticalCount,
      isOnHttps: httpsAudit?.score == null ? null : httpsAudit.score === 1,
      hasVulnerableLibrary:
        vulnAudit?.score == null ? null : vulnAudit.score === 0,
      formFactor: lhr.configSettings?.formFactor ?? null,
    },
  };
}
