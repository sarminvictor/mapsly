/**
 * Pure derivation helpers for the SMB dashboard.
 *
 * `deriveAlerts` + `deriveTopFixes` take the same snapshot-shaped
 * input the query layer has already fetched and produce the
 * priority-ordered lists the page renders. Pure (no IO, no Prisma)
 * so the unit tests can run them against synthetic fixtures.
 *
 * Voice is Maria-first per `.claude/rules/ui-ux-smb.md`:
 *   - "Reply rate" → "you reply to X% of reviews"
 *   - "Profile completeness" → "your Google profile is X% filled in"
 *   - "Brand hijack" → "another business is running ads using your name"
 *   - No "MSI", "LCP", "schema", "CTR", "NAP"
 */

import type {
  SmbDashboardAlert,
  SmbDashboardFix,
  SmbDashboardData,
} from "./types";

import { MAX_ALERTS } from "./types";

/** Input shape — subset of SmbDashboardData that derivation reads.
 * Keeping it explicit means callers can pass test fixtures without
 * building a full payload. */
export interface DeriveInput {
  unansweredReviewCount: number | null;
  reviewsLast30d: number | null;
  replyRate: number | null;
  rating: number | null;
  reviewCount: number | null;
  profileCompletenessScore: number | null;
  brandPresenceScore: number | null;
  brandHijackStatus: "clean" | "watch" | "hit";
  msiRank: number | null;
  msiTotal: number | null;
  /** Scoring v2 · is the business advertising + its ads pillar (0–10).
   * Optional so existing derivation fixtures keep typechecking. */
  adsApplicable?: boolean | null;
  adsPillar?: number | null;
}

/* ============================================================ alerts */

/**
 * Build the priority-ordered alert feed. Each rule examines one
 * source-of-truth field; rules with stronger evidence have lower
 * priority numbers (higher position).
 */
export function deriveAlerts(input: DeriveInput): SmbDashboardAlert[] {
  const alerts: SmbDashboardAlert[] = [];

  // 1 · Brand hijack — somebody is running ads using Maria's brand.
  if (input.brandHijackStatus === "hit") {
    alerts.push({
      id: "brand-hijack-hit",
      tone: "bad",
      priority: 1,
      body: "Another business is running ads using your name. People searching for you may land on them instead.",
      meta: "Brand hijack scan · last 24h",
    });
  } else if (input.brandHijackStatus === "watch") {
    alerts.push({
      id: "brand-hijack-watch",
      tone: "warn",
      priority: 5,
      body: "We spotted ads that mention words similar to your business name — worth a look.",
      meta: "Brand hijack scan · last 24h",
    });
  }

  // 2 · Unanswered reviews — first thing Maria can fix.
  if ((input.unansweredReviewCount ?? 0) > 0) {
    const n = input.unansweredReviewCount as number;
    alerts.push({
      id: "unanswered-reviews",
      tone: n >= 5 ? "bad" : "warn",
      priority: 2,
      body: `${n} review${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} waiting for a reply.`,
      meta: "Most spas reply to about 89%",
    });
  }

  // 3 · Reply-rate streak — Maria has reviews but hasn't been replying.
  if (
    input.replyRate != null &&
    input.replyRate < 0.25 &&
    (input.reviewCount ?? 0) >= 10
  ) {
    const pct = Math.round((input.replyRate ?? 0) * 100);
    alerts.push({
      id: "low-reply-rate",
      tone: "warn",
      priority: 3,
      body: `You've replied to ${pct}% of your reviews. A short reply on each one quietly lifts your rating.`,
      meta: "Across your last reviews",
    });
  }

  // 4 · Rating drift — Maria has lots of reviews and a so-so average.
  if (
    input.rating != null &&
    input.rating < 4.0 &&
    (input.reviewCount ?? 0) >= 20
  ) {
    alerts.push({
      id: "rating-drift",
      tone: "warn",
      priority: 4,
      body: `Your rating slipped to ${input.rating.toFixed(1)}. Below 4.0 starts costing you spots in Google Maps.`,
      meta: "Latest snapshot",
    });
  }

  // 5 · Profile is sparse.
  if (
    input.profileCompletenessScore != null &&
    input.profileCompletenessScore < 0.7
  ) {
    const pct = Math.round((input.profileCompletenessScore ?? 0) * 100);
    alerts.push({
      id: "profile-sparse",
      tone: "info",
      priority: 6,
      body: `Your Google profile is ${pct}% filled in. Hours, photos, and services help people find you.`,
      meta: "Profile completeness",
    });
  }

  // 6 · Low review volume — usually new businesses.
  if ((input.reviewCount ?? 0) > 0 && (input.reviewCount ?? 0) < 20) {
    alerts.push({
      id: "low-volume",
      tone: "info",
      priority: 7,
      body: `You only have ${input.reviewCount} reviews. A short ask after each visit usually doubles volume in a month.`,
      meta: "Review volume",
    });
  }

  alerts.sort((a, b) => a.priority - b.priority);
  return alerts.slice(0, MAX_ALERTS);
}

/* ============================================================ fixes */

/**
 * Pick the 3 highest-impact fixes. Same source data as alerts but
 * framed as imperative actions with quantified impact values.
 * Always returns at most 3 — the dashboard doesn't show "we got
 * nothing to suggest" gracefully; the empty-list case is handled by
 * the page.
 */
export function deriveTopFixes(input: DeriveInput): SmbDashboardFix[] {
  type Candidate = Omit<SmbDashboardFix, "rank"> & { priority: number };
  const candidates: Candidate[] = [];

  if ((input.unansweredReviewCount ?? 0) > 0) {
    const n = input.unansweredReviewCount as number;
    const lift = Math.min(0.9, 0.1 + 0.07 * n).toFixed(1);
    candidates.push({
      priority: 1,
      action: `Reply to ${n} unanswered review${n === 1 ? "" : "s"}`,
      meta: "Most spas reply to 89% · benchmark · ~5 min each",
      impact: `+${lift}`,
      impactSub: "Mapsly Score",
      tone: "good",
    });
  }

  // Scoring v2 · Ads is Maria's fastest growth lever — surface it as a quick
  // win when she isn't advertising (live today, while reputation + search are
  // long games). Market-relativity already keeps it honest in the pillar score.
  if (input.adsApplicable === false) {
    candidates.push({
      priority: 1,
      action: "Turn on Google or Meta ads",
      meta: "Rivals near you run them · you can be live today",
      impact: "Fast",
      impactSub: "boost this week",
      tone: "good",
    });
  }

  if (
    input.profileCompletenessScore != null &&
    input.profileCompletenessScore < 0.85
  ) {
    const missingPct = Math.round(
      (1 - (input.profileCompletenessScore ?? 0)) * 100,
    );
    candidates.push({
      priority: 2,
      action: "Fill in the missing parts of your Google profile",
      meta: `${missingPct}% missing · photos, hours, services · 10 min`,
      impact: "+0.4",
      impactSub: "Mapsly Score",
      tone: "good",
    });
  }

  if (
    input.rating != null &&
    input.rating < 4.5 &&
    (input.reviewCount ?? 0) >= 10
  ) {
    candidates.push({
      priority: 3,
      action: "Ask your last 10 happy customers for a review",
      meta: "Asks after a good visit lift rating 0.2–0.3 points",
      impact: `+${(4.5 - input.rating).toFixed(1)}`,
      impactSub: "rating points",
      tone: "good",
    });
  }

  if (input.brandPresenceScore != null && input.brandPresenceScore < 0.5) {
    candidates.push({
      priority: 4,
      action: "Add a Spanish-language welcome to your profile",
      meta: "Many of your future patients search in Spanish",
      impact: "+5",
      impactSub: "est. monthly visits",
      tone: "good",
    });
  }

  if (input.brandHijackStatus !== "clean") {
    candidates.push({
      priority: 0,
      action: "Look at the ads using your name",
      meta: "A competitor may be siphoning brand searches",
      impact: "—",
      impactSub: "brand defence",
      tone: "warn",
    });
  }

  candidates.sort((a, b) => a.priority - b.priority);

  return candidates.slice(0, 3).map((c, i) => ({
    rank: (i + 1) as 1 | 2 | 3,
    action: c.action,
    meta: c.meta,
    impact: c.impact,
    impactSub: c.impactSub,
    tone: c.tone,
  }));
}

/* ====================================================== combined */

/** Apply derivation to a partially-filled payload and return the
 * mutated copy. Used by the query layer after raw fetches resolve. */
export function withDerivedFields<
  T extends DeriveInput & Pick<SmbDashboardData, "alerts" | "topFixes">,
>(payload: T): T {
  return {
    ...payload,
    alerts: deriveAlerts(payload),
    topFixes: deriveTopFixes(payload),
  };
}
