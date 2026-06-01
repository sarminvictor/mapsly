/**
 * SMB website health · payload types.
 *
 * `SmbWebsiteData` is the flat shape the `/(smb)/website` page renders
 * from. It carries the latest LighthouseAudit translated into Maria-
 * speak — every label/copy that ships to users lives at the page +
 * derive layer, NOT in the database column names.
 *
 * Per `.claude/rules/ui-ux-smb.md` Maria's banned-word list (LCP,
 * INP, CLS, schema, NAP, GBP, organic rank, etc.) does NOT leak into
 * any user-visible string. The fields below use the database names
 * (`lcp`, `napConsistent`) because Prisma columns must stay neutral,
 * but the labels are derived through `deriveSpeedScore()` /
 * `deriveTopFixes()` which return PLAIN ENGLISH strings.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1: full EMPTY shape
 * + NEXT_PHASE guard in the query layer.
 */

/** Verdict tone used for the speed cards + fix-card chips. */
export type HealthTone = "good" | "warn" | "bad" | "neutral";

/**
 * One "speed signal" card · pre-translated label + value + tone.
 *
 * `value` is the user-readable string ("1.4s" / "85" / "Yes" / "—").
 * `tone` drives the colour pill.
 */
export interface WebsiteSpeedSignal {
  /** Stable key matching the i18n label. */
  key: "page_show" | "buttons" | "steady" | "overall_speed";
  /** Pre-formatted MOBILE value Maria reads. */
  value: string;
  tone: HealthTone;
  /** Desktop counterpart value, e.g. "4.2s". Null = no desktop data yet
   *  (hidden until the next re-audit, per the no-uncertain-results rule). */
  desktopValue: string | null;
  desktopTone: HealthTone;
  /** The goal so it's clear what "good" looks like, e.g. "under 2.5s". */
  target: string;
  /** Plain-English "what this means" line. */
  meaning: string;
}

/** One SEO/profile check · binary pass/fail with copy. */
export interface WebsiteCheck {
  /** Stable key matching the i18n label. */
  key:
    | "google_reads"
    | "google_tags"
    | "faq_tags"
    | "booking_top"
    | "phone_top"
    | "info_matches";
  /** Pass / fail / unknown · drives the icon + tone. */
  state: "pass" | "fail" | "unknown";
  /** Plain-English explanation Maria reads. */
  meaning: string;
}

/** One fix in the top-fixes list, ranked by impact. */
export interface WebsiteFix {
  rank: 1 | 2 | 3 | 4 | 5;
  /** Imperative action Maria can take. */
  action: string;
  /** Why it matters — one short sentence. */
  why: string;
  tone: "good" | "warn" | "neutral";
}

/** One row in the same-cell speed comparison table. */
export interface WebsiteCompetitor {
  /** Business name (the owner's row is flagged via `isYou`). */
  name: string;
  /** Speed score 0-100 (Lighthouse performance, most recent audit). */
  score: number;
  /** 1-based place within the cell, by score descending. */
  rank: number;
  isYou: boolean;
}

export interface SmbWebsiteData {
  ownedBusinessId: string;
  businessName: string;
  /** Maria's website URL (when we have it). */
  websiteUrl: string | null;
  /** Composite 0-100 score · "How healthy is your site?". */
  overallScore: number | null;
  /** Same 0-100 → "Quick" / "OK" / "Needs work" / "Slow". */
  overallVerdict: string;
  overallTone: HealthTone;

  /** Lighthouse SEO score 0-100 · shown as "Findable on Google". Already
   *  collected every audit — no extra run. Null until first audit. */
  seoScore: number | null;
  seoTone: HealthTone;

  /** 4 speed signals (page show / buttons / steady / overall). */
  speedSignals: WebsiteSpeedSignal[];
  /** 5 SEO/profile checks. */
  checks: WebsiteCheck[];
  /** Top fixes ranked by impact · capped at MAX_FIXES. */
  topFixes: WebsiteFix[];
  /** Tech stack tags from Wappalyzer (e.g. ["WordPress", "Stripe"]). */
  techStack: string[];

  /** Same-cell speed ranking · top 10 by score (+ your row if outside it).
   *  Empty until at least one competitor in the cell has a website score. */
  competitors: WebsiteCompetitor[];
  /** Your place among scored businesses in the cell · null if unranked. */
  yourRank: number | null;
  /** How many businesses in the cell have a score (the "of N"). */
  rankedTotal: number;

  /** When the latest audit ran. */
  auditedAt: Date | null;
}

export const EMPTY_SMB_WEBSITE: SmbWebsiteData = {
  ownedBusinessId: "",
  businessName: "",
  websiteUrl: null,
  overallScore: null,
  overallVerdict: "",
  overallTone: "neutral",
  seoScore: null,
  seoTone: "neutral",
  speedSignals: [],
  checks: [],
  topFixes: [],
  techStack: [],
  competitors: [],
  yourRank: null,
  rankedTotal: 0,
  auditedAt: null,
};

export const MAX_WEBSITE_FIXES = 5;

/* =========================================== pure derivations */

/**
 * Translate a Lighthouse Performance number 0-100 to Maria-speak.
 *   ≥ 90 · "Quick"        · good
 *   ≥ 70 · "OK"           · neutral
 *   ≥ 50 · "A bit slow"   · warn
 *   <  50 · "Slow"        · bad
 */
export function verdictForPerf(score: number | null): {
  verdict: string;
  tone: HealthTone;
} {
  if (score == null) return { verdict: "We'll check soon", tone: "neutral" };
  if (score >= 90) return { verdict: "Quick", tone: "good" };
  if (score >= 70) return { verdict: "OK", tone: "neutral" };
  if (score >= 50) return { verdict: "A bit slow", tone: "warn" };
  return { verdict: "Slow", tone: "bad" };
}

/**
 * Lighthouse SEO score 0-100 → tone for the "Findable on Google" pill.
 * Measures crawlability, title/description, mobile-friendliness + valid
 * structured data — i.e. is the page set up to be found, not how fast it is.
 */
export function toneForSeo(score: number | null): HealthTone {
  if (score == null) return "neutral";
  if (score >= 90) return "good";
  if (score >= 70) return "neutral";
  if (score >= 50) return "warn";
  return "bad";
}

/** LCP seconds → Maria-friendly tone + display value. */
export function verdictForLcp(lcpSeconds: number | null): {
  value: string;
  tone: HealthTone;
} {
  if (lcpSeconds == null) return { value: "—", tone: "neutral" };
  const s = lcpSeconds.toFixed(1);
  if (lcpSeconds <= 2.5) return { value: `${s}s`, tone: "good" };
  if (lcpSeconds <= 4.0) return { value: `${s}s`, tone: "warn" };
  return { value: `${s}s`, tone: "bad" };
}

/** INP milliseconds → Maria-friendly tone + display value. */
export function verdictForInp(inpMs: number | null): {
  value: string;
  tone: HealthTone;
} {
  if (inpMs == null) return { value: "—", tone: "neutral" };
  const v = Math.round(inpMs);
  if (inpMs <= 200) return { value: `${v}ms`, tone: "good" };
  if (inpMs <= 500) return { value: `${v}ms`, tone: "warn" };
  return { value: `${v}ms`, tone: "bad" };
}

/** CLS 0-1 → Maria-friendly tone + display value. */
export function verdictForCls(cls: number | null): {
  value: string;
  tone: HealthTone;
} {
  if (cls == null) return { value: "—", tone: "neutral" };
  const v = cls.toFixed(2);
  if (cls <= 0.1) return { value: v, tone: "good" };
  if (cls <= 0.25) return { value: v, tone: "warn" };
  return { value: v, tone: "bad" };
}

/**
 * Pure derivation · build the prioritised top-fixes list. Each rule
 * examines one signal from the latest LighthouseAudit and produces a
 * fix card. Sorted by priority (lower = higher), capped at 5.
 */
export interface DeriveFixesInput {
  performance: number | null;
  lcpSeconds: number | null;
  hasLocalBusinessSchema: boolean | null;
  hasFaqSchema: boolean | null;
  hasBookingCtaAboveFold: boolean | null;
  hasPhoneAboveFold: boolean | null;
  napConsistent: boolean | null;
}

export function deriveWebsiteFixes(input: DeriveFixesInput): WebsiteFix[] {
  type Candidate = Omit<WebsiteFix, "rank"> & { priority: number };
  const candidates: Candidate[] = [];

  if (input.lcpSeconds != null && input.lcpSeconds > 2.5) {
    candidates.push({
      priority: 1,
      action: "Speed up the first thing people see on your site",
      why: `Right now your page takes ${input.lcpSeconds.toFixed(1)} seconds to show up. People give up around 3 seconds.`,
      tone: "warn",
    });
  } else if (input.performance != null && input.performance < 50) {
    candidates.push({
      priority: 1,
      action: "Cut the heavy bits on your homepage",
      why: "Google scored your site below 50/100 for speed — that drops you in search results.",
      tone: "warn",
    });
  }

  if (input.napConsistent === false) {
    candidates.push({
      priority: 2,
      action: "Make sure your name, address, and phone match everywhere",
      why: "When Google sees different versions of your phone or address across the web, it trusts the listing less.",
      tone: "warn",
    });
  }

  if (input.hasLocalBusinessSchema === false) {
    candidates.push({
      priority: 3,
      action: "Add the hidden tags Google uses to understand your business",
      why: "Tiny invisible labels on your homepage help Google show your hours, rating, and phone in search results.",
      tone: "good",
    });
  }

  if (input.hasPhoneAboveFold === false) {
    candidates.push({
      priority: 4,
      action: "Show your phone number at the top of every page",
      why: "About 40% of mobile searches still want to call you. A click-to-call link at the top doubles bookings.",
      tone: "good",
    });
  }

  if (input.hasBookingCtaAboveFold === false) {
    candidates.push({
      priority: 5,
      action: "Put your booking button at the top of your homepage",
      why: "Most people decide whether to book in the first 5 seconds. Bury the button and they leave.",
      tone: "good",
    });
  }

  if (input.hasFaqSchema === false) {
    candidates.push({
      priority: 6,
      action: "Add a short FAQ section to your homepage",
      why: "Google can pull common questions straight into search results — free visibility for the answers your customers ask anyway.",
      tone: "good",
    });
  }

  candidates.sort((a, b) => a.priority - b.priority);

  return candidates.slice(0, 5).map((c, i) => ({
    rank: (i + 1) as 1 | 2 | 3 | 4 | 5,
    action: c.action,
    why: c.why,
    tone: c.tone,
  }));
}
