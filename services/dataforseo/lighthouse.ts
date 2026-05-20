// services/dataforseo/lighthouse.ts · Lighthouse audit via DataForSEO.
//
// Endpoint: /v3/on_page/lighthouse/live/json
// Use case: weekly lighthouse-audit (C.9). Returns full Lighthouse v10 JSON
// for a target URL, mobile preset by default. Persisted to
// `LighthouseAudit` rows for downstream score computation.
//
// Cache: 24h. A site's CWV doesn't change minute-to-minute; a daily ceiling
// is more than enough.
//
// Cost: $0.0025 per audit (Live tier). DataForSEO charges per audit
// regardless of audit depth (categories included). We always request all
// 5 categories (performance, accessibility, best-practices, seo, pwa) and
// score breakdowns happen client-side from the JSON.
//
// Timeout: 60s · Lighthouse audits routinely take 10-25s, occasionally
// stretching to 40s on slow targets. Overrides the 10s default in the
// shared client.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";

// ---- Schemas ------------------------------------------------------------

export const LighthouseQuerySchema = z.object({
  url: z.string().url(),
  /** Lighthouse preset. Defaults to mobile per `.claude/rules/performance.md`
   *  (we score mobile; desktop is informational). */
  for_mobile: z.boolean().default(true),
  /** Audit categories to run. Default to all five so the persisted JSON
   *  carries everything; client-side scoring picks what it needs. */
  categories: z
    .array(
      z.enum(["performance", "accessibility", "best-practices", "seo", "pwa"]),
    )
    .min(1)
    .default(["performance", "accessibility", "best-practices", "seo", "pwa"]),
});
export type LighthouseQuery = z.input<typeof LighthouseQuerySchema>;

/** Lighthouse top-level category score (0..1 per spec, 0..100 in some
 *  responses — we permit both and normalize in `extractScores`). */
const LighthouseCategorySchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  score: z.number().nullable().optional(),
});

const LighthouseAuditValueSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  score: z.number().nullable().optional(),
  numericValue: z.number().nullable().optional(),
  numericUnit: z.string().optional(),
  displayValue: z.string().optional(),
});

/** Result item — Lighthouse JSON is enormous; we schema only the fields we
 *  read for score persistence. Pass-through preserves the full payload for
 *  downstream consumers via `raw`. */
const LighthouseResultSchema = z
  .object({
    url: z.string().optional(),
    crawled_url: z.string().optional(),
    fetch_time: z.string().optional(),
    lighthouse_version: z.string().optional(),
    categories: z
      .record(z.string(), LighthouseCategorySchema)
      .nullable()
      .optional(),
    audits: z
      .record(z.string(), LighthouseAuditValueSchema)
      .nullable()
      .optional(),
  })
  .passthrough();
type LighthouseRawResult = z.infer<typeof LighthouseResultSchema>;

export interface LighthouseAuditResult {
  url: string;
  /** Lighthouse Performance score normalized to 0..100, null if missing. */
  performance: number | null;
  /** Lighthouse Accessibility score 0..100. */
  accessibility: number | null;
  /** Lighthouse Best Practices score 0..100. */
  bestPractices: number | null;
  /** Lighthouse SEO score 0..100. */
  seo: number | null;
  /** Lighthouse PWA score 0..100 (often null when not requested). */
  pwa: number | null;
  /** Largest Contentful Paint in ms. */
  lcpMs: number | null;
  /** Cumulative Layout Shift (unitless). */
  cls: number | null;
  /** Total Blocking Time in ms (INP proxy in lab data). */
  tbtMs: number | null;
  /** First Contentful Paint in ms. */
  fcpMs: number | null;
  /** Full Lighthouse JSON for archival. Persist to `LighthouseAudit.rawJson`. */
  raw: LighthouseRawResult;
  operation: string;
}

// ---- Adapter ------------------------------------------------------------

const OPERATION = "dataforseo.lighthouse.audit";

async function lighthouseAuditRaw(
  query: LighthouseQuery,
): Promise<LighthouseAuditResult> {
  const parsed = LighthouseQuerySchema.parse(query);
  const { result } = await dataforSeoPost<LighthouseRawResult>({
    path: "/v3/on_page/lighthouse/live/json",
    operation: OPERATION,
    body: parsed,
    // Lighthouse routinely takes 10-25s; 10s default is too tight.
    timeoutMs: 60_000,
  });
  const first = LighthouseResultSchema.parse(result[0] ?? {});
  return {
    url: first.url ?? first.crawled_url ?? parsed.url,
    ...extractScores(first),
    ...extractMetrics(first),
    raw: first,
    operation: OPERATION,
  };
}

export const lighthouseAuditUncached = withCostCounter(
  OPERATION,
  DATAFORSEO_UNIT_COST_USD.lighthouse,
  lighthouseAuditRaw,
);

export const lighthouseAudit = kvCache(
  "dfs:lighthouse:audit",
  { ttl: 24 * 60 * 60, tag: "dfs:lighthouse" },
  lighthouseAuditUncached,
);

// ---- Helpers ------------------------------------------------------------

/** Normalize a Lighthouse category score to 0..100. Lighthouse JSON v10
 *  reports scores in 0..1; some DataForSEO responses pre-multiply to
 *  0..100. Accept both. */
function normalizeScore(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  // Already in 0..100.
  if (raw > 1) return Math.round(raw);
  return Math.round(raw * 100);
}

function extractScores(r: LighthouseRawResult): {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  pwa: number | null;
} {
  const c = r.categories ?? {};
  return {
    performance: normalizeScore(c.performance?.score),
    accessibility: normalizeScore(c.accessibility?.score),
    bestPractices: normalizeScore(c["best-practices"]?.score),
    seo: normalizeScore(c.seo?.score),
    pwa: normalizeScore(c.pwa?.score),
  };
}

function extractMetrics(r: LighthouseRawResult): {
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
} {
  const a = r.audits ?? {};
  return {
    lcpMs: numericOrNull(a["largest-contentful-paint"]?.numericValue),
    cls: numericOrNull(a["cumulative-layout-shift"]?.numericValue),
    tbtMs: numericOrNull(a["total-blocking-time"]?.numericValue),
    fcpMs: numericOrNull(a["first-contentful-paint"]?.numericValue),
  };
}

function numericOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
