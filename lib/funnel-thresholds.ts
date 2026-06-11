/**
 * Miami-cohort funnel gates · plan #17 (APPROVED 2026-06-10).
 *
 * The pass/fail thresholds Viktor agreed at campaign creation — drafted in
 * docs/improvement-plan-2026-06-09.md row 17:
 *
 *   email → page      ≥ 5%     (humans landing on /l per delivered email)
 *   page  → CTA/free  ≥ 8%     (humans clicking a paid CTA OR the free signup)
 *   page  → paid      ≥ 0.5%   (humans buying the $29 subscription)
 *
 * EVERY rate is computed on HUMAN-classified traffic only (lib/bot-detect.ts).
 * Opens are NOT a gate: Apple MPP / Gmail proxies auto-fetch the pixel and
 * inflate opens ~50% — treat ColdSend opens as a fuzzy upper bound for
 * diagnosing WHICH layer to fix, never as a funnel denominator.
 *
 * Dashboards show human-only AND raw side by side (decision log #17).
 */

/** Which layer to rework when its gate fails (the "fix triggers"). */
export type FunnelLayer = "email" | "landing" | "offer";

export interface FunnelGate {
  id: "email_to_page" | "page_to_engaged" | "page_to_paid";
  label: string;
  /** Minimum passing rate, as a fraction (0.05 = 5%). */
  minRate: number;
  /** What counts in the numerator (human-only). */
  numerator: string;
  /** What counts in the denominator. */
  denominator: string;
  /** The layer to fix when this gate fails. */
  fixLayer: FunnelLayer;
  /** Concrete first move when the gate fails. */
  fixHint: string;
}

export const FUNNEL_GATES: readonly FunnelGate[] = [
  {
    id: "email_to_page",
    label: "Email → page",
    minRate: 0.05,
    numerator:
      "unique human visitors (visitorId) with a non-bot PAGE_OPENED on a cohort landing",
    denominator: "ColdSend rows SENT minus hard bounces (delivered)",
    fixLayer: "email",
    fixHint:
      "Below 5%: fix the email layer. Opens high but visits low → body copy / link placement. Opens low too → subject line, sender reputation, deliverability.",
  },
  {
    id: "page_to_engaged",
    label: "Page → CTA or free signup",
    minRate: 0.08,
    numerator:
      "unique human visitors with CTA_CLICKED or FREE_SIGNUP (either counts — the free weekly-score button is a conversion)",
    denominator: "unique human visitors with PAGE_OPENED",
    fixLayer: "landing",
    fixHint:
      "Below 8%: fix the landing layer — above-the-fold message, trust signals, CTA placement. Check SECTION_VIEWED depth: shallow scroll → hero problem; deep scroll, no click → offer-framing problem.",
  },
  {
    id: "page_to_paid",
    label: "Page → paid",
    minRate: 0.005,
    numerator: "SUBSCRIPTION_BOUGHT events (server-side, Stripe webhook)",
    denominator: "unique human visitors with PAGE_OPENED",
    fixLayer: "offer",
    fixHint:
      "Below 0.5%: fix the offer layer — price framing, checkout friction, or lean on the free signup to nurture instead of pushing direct-to-paid.",
  },
] as const;

/**
 * The named fallback (decision log #17): if the gates still fail after the
 * verdict window of cold sends, cold-direct is judged missed — pivot to
 * white-labeling the audit engine to agencies.
 */
export const VERDICT_MIN_SENDS = 2000;
export const VERDICT_MAX_SENDS = 3000;
export const FALLBACK_PLAN =
  "Agency white-label pivot: package the audit/landing engine for marketing agencies instead of selling direct to SMBs.";

export interface FunnelCounts {
  /** ColdSend SENT minus hard bounces. */
  delivered: number;
  /** Unique HUMAN visitors with PAGE_OPENED (bot-filtered). */
  humanPageVisits: number;
  /** Unique HUMAN visitors with CTA_CLICKED or FREE_SIGNUP. */
  humanEngaged: number;
  /** SUBSCRIPTION_BOUGHT count. */
  paid: number;
}

export interface GateResult {
  gate: FunnelGate;
  /** Observed rate, or null when the denominator is 0 (no data yet). */
  rate: number | null;
  /** true = passing · false = failing · null = no data yet. */
  pass: boolean | null;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Evaluate all three gates against human-only counts. */
export function evaluateFunnelGates(counts: FunnelCounts): GateResult[] {
  const rates: Record<FunnelGate["id"], number | null> = {
    email_to_page: rate(counts.humanPageVisits, counts.delivered),
    page_to_engaged: rate(counts.humanEngaged, counts.humanPageVisits),
    page_to_paid: rate(counts.paid, counts.humanPageVisits),
  };
  return FUNNEL_GATES.map((gate) => {
    const r = rates[gate.id];
    return { gate, rate: r, pass: r == null ? null : r >= gate.minRate };
  });
}
