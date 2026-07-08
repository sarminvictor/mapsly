// modules/outreach/first-touch.ts · signal-grounded first-touch skeleton
// (Phase 8). The HONESTY backbone of personalized outreach: a deterministic
// skeleton whose every line is bound to a real signal — a line is OMITTED when
// its signal is absent, so we never emit an empty `{{token}}` or a claim we
// can't back. (The gpt-5.4-nano "fill" pass that rewords this for fluency is a
// separate service step; it may only rephrase grounded lines, never invent
// facts.) Pure + testable.

export type TouchChannel = "email" | "dm" | "phone" | "social";
export type PredictedTier = "high" | "medium" | "low";

/** Real signals about one prospect. Every field is optional; only present
 *  fields produce copy. */
export interface TouchSignals {
  businessName: string;
  city?: string | null;
  /**
   * WP7-4 / A11 (touchpoints audit 2026-07-07) · recipient country ("US" |
   * "CA" | other | null). Drives the compliance-footer branch: US → the short
   * CAN-SPAM footer; EVERYTHING ELSE — CA, other, null/unknown — → the CASL
   * framing (sender ID + consent basis + address + unsubscribe). CASL is a
   * compliant SUPERSET of CAN-SPAM, so an unknown-country lead (possibly
   * Canadian) always gets the stricter footer. (Pre-A11 the default was
   * CAN-SPAM, which sent a CA lead with a null country a non-compliant footer.)
   */
  country?: string | null;
  /** WP7-4 · the business's public email (for the ConsentRecord basis). */
  recipientEmail?: string | null;
  noun?: string | null; // audience noun ("patients", "guests", "customers")
  unansweredNegative?: number | null;
  /**
   * A5 · true when the unanswered-negative count comes from a PARTIAL review
   * pull (pulled rows < 80% of the listing's reviewCount) — the live test
   * caught "You have 2 unanswered negative reviews" computed from an 11-of-607
   * sample. Partial → the pain line reads "at least N"; the number itself stays
   * EXACT (the nano fact-check matches numbers downstream).
   */
  reviewSamplePartial?: boolean | null;
  reviewLifecycle?: "TRENDING" | "STABLE" | "DYING" | "DORMANT" | null;
  reviewsVsCellPercentile?: number | null; // 0–100
  lcpSeconds?: number | null;
  lighthousePerf?: number | null; // 0–100
  competitorAdsCount?: number | null; // rivals advertising in the cell
  runsAds?: boolean | null;
  hasBookingTool?: boolean | null;
  hipaaPixelRisk?: boolean | null;

  // ── Touchpoints v2 (2026-07-07) · this-business-only "stand out" facts. Every
  // one is a REAL per-business datum (a NAME, a NUMBER, a RANK, a QUOTE) mirrored
  // from the lead-detail drawer's own fetches. All nullable — a richer line fires
  // only when its datum is present, else the copy falls back to the current line.
  // NEVER a competitor's metric we don't store (no fabricated "rival loads in
  // 1.9s"); the nano fact-check rejects any number not passed in here.

  /**
   * A1 · the strongest named nearby rival — rivalsFrom(peopleAlsoSearch)[0].name
   * ONLY. A business Google surfaces in its "people also search for" cluster
   * ADJACENT to this one. INC-54 · this is an ADJACENCY name, NOT a ranked or
   * pack-leader entity — render it only in co-occurrence copy ("turns up next to
   * you"), never as a rank/precedence claim ("ahead of you", "#N"). Null when
   * discovery surfaced none.
   */
  topRivalName?: string | null;
  /** A1 · how many OTHER named rivals we have beyond `topRivalName` ("and 2
   *  others") — from the peopleAlsoSearch list length. 0/null → no "and N". */
  otherRivalCount?: number | null;

  /**
   * A2 · local 3-pack rank + organic position from the newest SerpResult.
   *
   * INC-54 · NOT RENDERED in copy. The gatherer's SerpResult query is unfiltered
   * by keyword, so an `organicRank` may belong to an arbitrary DataForSEO
   * ranked-portfolio keyword — NOT `trackedKeyword`. Binding a real rank to the
   * derived keyword ("you're #7 for 'acupuncture boise'") is a disprovable
   * fabrication, so these two are gathered-but-unused pending real keyword
   * resolution (join SerpResult.keywordId → Keyword.keyword). Do NOT re-surface
   * them in a "#N for {trackedKeyword}" claim.
   */
  localPackRank?: number | null;
  organicRank?: number | null;
  /**
   * A2 · derived "{category} {city}" (lowercased). INC-54 · NOT RENDERED. It is
   * a GUESS — not the keyword any stored rank/pack row was actually scanned
   * under — so quoting it next to a rank or a pack leader is a disprovable
   * claim. Gathered for a future keyword-reconciliation pass (SerpResult.
   * keywordId → Keyword.keyword, filtered to the same row).
   */
  trackedKeyword?: string | null;
  /**
   * A1/A2 · the pack leader from the newest SerpResult (pack1Name). INC-54 · NOT
   * RENDERED. pack1Name is written per-keyword by TWO scanners (cell-intel MAPS
   * for "{category} {city}" AND aggregate-cell-maps across the whole template
   * pool) and the gatherer's read isn't keyword-filtered, so this leader is
   * routinely for a DIFFERENT keyword than trackedKeyword — never pair them.
   */
  packLeaderName?: string | null;

  /**
   * A3 · a REAL pulled unanswered ≤3★ review's verbatim text (truncated). Only
   * set when such a row exists — the unanswered-negative pain then QUOTES it.
   */
  recentUnansweredReviewQuote?: string | null;
  /** A3 · that review's star count (1–3). */
  reviewQuoteStars?: number | null;
  /** A3 · that review's month name ("June") — from postedAt, a data field (not
   *  wall-clock; determinism-safe). */
  reviewQuoteMonth?: string | null;

  /**
   * A4 · the sharpest AI-derived pain hypothesis (BusinessEnrichment.
   * painHypotheses[0]) when short + grounded — the step-2 deepener's fallback
   * fact. Null when no AI research ran or the hypothesis is too long.
   */
  aiPainHypothesis?: string | null;

  /** A5 · the NAMED booking incumbent (BusinessTech BOOKING name) when the site
   *  DOES have booking — unused by the no-booking pain, reserved for future
   *  "you're on {tool}" framing. Null when unknown or no named tool. */
  bookingToolName?: string | null;
  /** A5 · whole years the business has been on Google (firstSeenOnGoogle proxy).
   *  A tenure fact for the opener/deepener. Null when unknown. */
  yearsOnGoogle?: number | null;

  /**
   * A10 · a short, grounded category label for the opener ("acupuncture
   * clinics") — from Business.category, lightly pluralized/humanized. Lets a
   * variant read "I help acupuncture clinics around Boise…" instead of the
   * generic "local businesses". Null when we have no clean category → the
   * generic opener stays. Never invented; a real listing category or nothing.
   */
  categoryLabel?: string | null;
}

/** Deterministic voice variants (WP5-1). All stay grounded — tone only swaps
 *  the opener/close phrasing, never the pain lines or facts. */
export type TouchTone = "direct" | "warm" | "brief";

export interface TouchOptions {
  sellingWhat: string; // what the agency offers
  channel: TouchChannel;
  /** Required for email per CAN-SPAM / CASL (postal address). */
  mailingAddress?: string | null;
  unsubscribeUrl?: string | null;
  /** WP7-4 · sending agency name — used for the CASL sender-ID footer line. */
  senderName?: string | null;
  /** Voice variant — defaults to "direct" (the original skeleton). */
  tone?: TouchTone;
  /**
   * Restrict the pain lines to these theme keys (see PAIN_THEMES). Absent →
   * all grounded themes are eligible. A key still only fires when its signal
   * is actually present — this narrows, never fabricates.
   */
  allowedPainKeys?: readonly string[];
  /**
   * Theme keys already used by EARLIER steps of the same sequence (WP5-10
   * non-repeating themes). Excluded from this touch's pain selection.
   */
  excludePainKeys?: readonly string[];
  /** 1-based step within a 1–3 touch sequence. Steps ≥2 render as follow-ups. */
  sequenceStep?: number;
  /**
   * WP6-15 · Lead-collision diversification seed. When two agencies pitch the
   * SAME prospect, an identical severity ranking makes them send verbatim
   * openers. This seed (an agency id) deterministically rotates the ORDER of
   * pains WITHIN the same severity band — never across bands — so the sharpest
   * tier still leads, but which of the comparably-sharp hooks comes first
   * differs per agency. Absent → the canonical severity-desc order (unchanged).
   */
  agencySeed?: string | null;
  /**
   * A2/A14/A16 · per-BUSINESS variation seed (the businessId). Deterministically
   * rotates the subject variant, the opener frame, and the CTA variant so a
   * same-batch cohort doesn't ship byte-identical subjects/frames (Gmail
   * duplicate-fingerprinting; the live test measured ~85–90% identical bodies
   * within a geo cohort). Grounded PAIN lines are untouched — only the framing
   * rotates. Absent → variant 0 everywhere (the canonical phrasing). Distinct
   * from `agencySeed`, which rotates pain ORDER across agencies (WP6-15).
   */
  variantSeed?: string | null;
  /**
   * A12 (touchpoints v2 2026-07-07) · subject-name toggle for the founder's A/B.
   * Default (false, the EXPERT recommendation): a lowercase, specific,
   * no-name subject that reads like a person, not a campaign ("you're behind
   * zen wellness on google"). When true: prepend the SHORT business name and
   * Title-Case the whole subject ("Glow Spa — Your Site's 7.7s Load"). The
   * grounded pain/number/name inside the subject is identical either way — only
   * the name prefix + casing differ. A3 truthfulness is preserved: any number
   * still comes from the same body-backed variant table.
   */
  includeNameInSubject?: boolean;
}

/**
 * The canonical pain-theme catalog (key + plain label), mirroring painLines()
 * below. Client-safe: the WP5-1 overlay renders its pain multipicker from this
 * list and passes the chosen keys back as `painPointKeys`.
 */
export const PAIN_THEMES = [
  { key: "hipaa_pixel_risk", label: "HIPAA pixel risk" },
  { key: "unanswered_negative", label: "Unanswered negatives" },
  { key: "review_decline", label: "Review momentum decline" },
  { key: "ads_no_booking", label: "Ads without online booking" },
  { key: "slow_site", label: "Slow site" },
  { key: "competitor_ads", label: "Competitor ads" },
  { key: "no_booking", label: "No online booking" },
] as const;

export type PainThemeKey = (typeof PAIN_THEMES)[number]["key"];

export interface FirstTouch {
  subject?: string;
  body: string;
  /** "Why this works" — the grounded reasons, for the UI. */
  why: string[];
  predictedTier: PredictedTier;
  usedSignals: string[];
  /** Tokens/lines dropped because their signal was absent (audit). */
  droppedTokens: string[];
}

interface PainLine {
  key: string;
  present: boolean;
  line: string;
  why: string;
  severity: number; // higher = sharper pain, picked first
}

/**
 * Severity BANDS for WP6-15 collision diversification. Pains within one band
 * are comparably sharp, so their lead order may rotate per agency; the bands
 * themselves never reorder (the sharpest tier always leads). Derived from the
 * severity number so painLines() stays the single source of the ranking.
 *
 *   band 0 — severity ≥ 90 (the standout hook, e.g. HIPAA) · never rotated
 *   band 1 — 60–89  (unanswered negatives / review decline / ads-no-booking)
 *   band 2 — < 60   (slow site / not-in-pack / competitor ads / no booking)
 */
function severityBand(severity: number): number {
  if (severity >= 90) return 0;
  if (severity >= 60) return 1;
  return 2;
}

/**
 * A small deterministic non-negative hash of an agency seed → used as a
 * rotation offset within a severity band. Same seed always yields the same
 * order (idempotent, replayable); different agencies get different rotations.
 */
function seedHash(seed: string): number {
  let h = 2166136261; // FNV-1a basis
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0; // force unsigned
}

/**
 * A2/A14/A16 · deterministic variant pick: same (seed, salt) always yields the
 * same index; different businesses (seeds) spread across the variant space.
 * No seed → 0 (the canonical variant, which keeps un-seeded callers and legacy
 * tests byte-stable).
 */
function variantIndex(
  seed: string | null | undefined,
  salt: string,
  len: number,
): number {
  if (!seed || len <= 1) return 0;
  return seedHash(`${seed}|${salt}`) % len;
}

/**
 * A14 · human-shorten a legal business name for subjects / CTA / warm opener.
 * The live test shipped "…what I found for Serenity Aesthetics Laser &
 * Advanced Skin Care Inc?" — no human types the legal suffix. Conservative,
 * never empty:
 *   1. drop a trailing parenthetical ("X (Downtown)" → "X")
 *   2. drop a "· …" descriptor tail
 *   3. strip trailing legal suffixes (Inc/LLC/Ltd/Corp/Co/…, with or without
 *      punctuation) — but never when that would leave a dangling "&"
 *   4. only when still > 30 chars, drop a descriptor tail after the first
 *      dash separator ("Name — Laser & Skin Clinic" → "Name")
 * Falls back to the original name whenever a step would produce an empty or
 * one-char string.
 */
export function shortBusinessName(name: string): string {
  const original = name.trim();
  const safe = (candidate: string): string | null => {
    const c = candidate.trim().replace(/[,\s]+$/, "");
    return c.length >= 2 ? c : null;
  };
  let out = original;
  out = safe(out.replace(/\s*\([^)]*\)\s*$/, "")) ?? out;
  out = safe(out.split("·")[0]) ?? out;
  const noSuffix = out.replace(
    /,?\s+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|pllc|pc|p\.c)\.?$/i,
    "",
  );
  if (!/&$/.test(noSuffix.trim())) out = safe(noSuffix) ?? out; // "Smith & Co" stays
  if (out.length > 30) {
    const head = out.split(/\s+[—–-]\s+/)[0];
    out = safe(head) ?? out;
  }
  return out.length >= 2 ? out : original;
}

// ── A7 · pitch-aware pain ranking ────────────────────────────────────────────

/**
 * sellingWhat keyword → the pain themes that pitch matches. A 23.2s LCP under
 * a literal "website speed fixes" pitch was ALWAYS outranked by generic review
 * pains (sev 70–80 vs 55) in the live test — the sharpest hook for the
 * agency's actual service never shipped.
 */
const PITCH_THEME_KEYWORDS: readonly {
  pattern: RegExp;
  themes: readonly PainThemeKey[];
}[] = [
  {
    pattern: /\b(site|website|web|speed|redesign)\b/,
    themes: ["slow_site"],
  },
  {
    // An SEO / local-search / rank pitch boosts slow_site (page speed feeds
    // ranking) — the honest, grounded proxy we can actually stand behind.
    pattern: /\b(seo|search|ranking|rank|local pack|3-?pack|maps)\b/,
    themes: ["slow_site"],
  },
  {
    pattern: /\b(booking|scheduling|appointments?)\b/,
    themes: ["no_booking", "ads_no_booking"],
  },
  {
    pattern: /\b(reviews?|reputation)\b/,
    themes: ["unanswered_negative", "review_decline"],
  },
  {
    pattern: /\b(ads?|advertising|ppc|meta|google ads)\b/,
    themes: ["competitor_ads", "ads_no_booking"],
  },
  {
    pattern: /\b(privacy|hipaa|compliance)\b/,
    themes: ["hipaa_pixel_risk"],
  },
];

/** Boost added to a theme whose domain matches the pitch. */
const PITCH_BOOST = 30;
/** Boosted severity ceiling — one below band 0 (≥90), so the HIPAA standout
 *  (100) can never be outranked or joined by a boosted generic theme. */
const PITCH_BOOST_CAP = 89;

/** The pain themes `sellingWhat` matches (empty set = no boost anywhere). */
function pitchThemesFor(sellingWhat: string): ReadonlySet<string> {
  const s = sellingWhat.toLowerCase();
  const out = new Set<string>();
  for (const { pattern, themes } of PITCH_THEME_KEYWORDS) {
    if (pattern.test(s)) for (const t of themes) out.add(t);
  }
  return out;
}

/**
 * Apply the pitch boost to matched themes: severity < 90 gets +30 capped at 89
 * (top of band 1); severities ≥ 90 (HIPAA) are never touched — the band-0
 * standout still leads unconditionally, and the WP6-15 within-band rotation
 * stays deterministic on the BOOSTED severities.
 */
function applyPitchBoost(lines: PainLine[], sellingWhat: string): PainLine[] {
  const boosted = pitchThemesFor(sellingWhat);
  if (boosted.size === 0) return lines;
  return lines.map((l) =>
    boosted.has(l.key) && l.severity < 90
      ? {
          ...l,
          severity: Math.min(PITCH_BOOST_CAP, l.severity + PITCH_BOOST),
        }
      : l,
  );
}

/**
 * Order present pains sharpest-first, then rotate WITHIN each severity band by
 * the agency seed (WP6-15). Without a seed this is exactly the canonical
 * `severity desc` order. Pure + deterministic.
 */
export function orderPains(
  pains: PainLine[],
  agencySeed?: string | null,
): PainLine[] {
  const bySeverity = [...pains].sort((a, b) => b.severity - a.severity);
  if (!agencySeed) return bySeverity;

  // Group into contiguous bands (input is already severity-desc), rotate each
  // band's members by the seeded offset, then re-concatenate band order.
  const out: PainLine[] = [];
  const rot = seedHash(agencySeed);
  let i = 0;
  while (i < bySeverity.length) {
    const band = severityBand(bySeverity[i].severity);
    const group: PainLine[] = [];
    while (
      i < bySeverity.length &&
      severityBand(bySeverity[i].severity) === band
    ) {
      group.push(bySeverity[i]);
      i += 1;
    }
    // Band 0 (the standout) never rotates — keep the sharpest hook leading.
    if (band === 0 || group.length < 2) {
      out.push(...group);
      continue;
    }
    const offset = rot % group.length;
    out.push(...group.slice(offset), ...group.slice(0, offset));
  }
  return out;
}

/**
 * A3 · quote a REAL pulled unanswered review inside the unanswered-negative
 * pain — the sharpest "this-business-only" fact. Fires only when we actually
 * pulled a ≤3★ unanswered row WITH text (quote + stars present); the month is a
 * nice-to-have. Everything here is verbatim data (the nano fact-check accepts
 * the star number because it's in this line). Returns null → the caller uses
 * the count-based line below.
 */
function unansweredQuoteLine(s: TouchSignals): string | null {
  const quote = s.recentUnansweredReviewQuote?.trim();
  const stars = s.reviewQuoteStars;
  if (!quote || typeof stars !== "number") return null;
  const when = s.reviewQuoteMonth ? ` from ${s.reviewQuoteMonth}` : "";
  return `a ${stars}★${when} — “${quote}” — is still sitting there with no reply.`;
}

/**
 * The competitor_ads line is COUNT-ONLY, worded to exactly what the signal
 * proves. `competitorAdsCount` is the number of distinct advertisers in this
 * cell's Meta Ad Library run (generate.ts gatherTouchSignals) — i.e. businesses
 * in the same category+area that run ads, while this prospect does not.
 *
 * HONESTY (touch v2 review 2026-07-07, INC-54): we deliberately DO NOT name a
 * rival here or quote a keyword. `topRivalName` is a Google-Maps
 * "people also search for" adjacency seed — we have ZERO evidence it advertises
 * — and `trackedKeyword` is a synthesized "{category} {city}" string, not a
 * keyword any ad was matched on. Splicing them ("Zen Wellness is running Google
 * ads for 'acupuncture boise'") is a fabricated, disprovable claim. The count is
 * the only grounded fact, so the count is all we say.
 */
function competitorAdsLine(s: TouchSignals): string {
  const count = s.competitorAdsCount ?? 0;
  return `${count} ${count === 1 ? "business" : "businesses"} in ${s.city || "your area"} ${count === 1 ? "is" : "are"} running ads while you're not.`;
}

/** Build the candidate pain lines, each gated by signal presence. */
function painLines(s: TouchSignals): PainLine[] {
  const noun = s.noun || "customers";
  const quoteLine = unansweredQuoteLine(s);
  return [
    {
      key: "hipaa_pixel_risk",
      present: s.hipaaPixelRisk === true,
      severity: 100,
      line: `I noticed a tracking pixel on your booking page — for a health business that's a privacy-exposure worth a quick check.`,
      why: "HIPAA pixel exposure detected (highest-value, low-supply pitch)",
    },
    {
      key: "unanswered_negative",
      present: (s.unansweredNegative ?? 0) > 0,
      severity: 80,
      // A3/A7 · PREFER quoting a REAL pulled unanswered review (the
      // this-business-only fact). When no quote was pulled, fall back to the
      // count line. A5 · a PARTIAL review pull says "at least N" (the pull may
      // be a small sample of the listing — an exact claim the owner can
      // disprove kills credibility mid-read). The number stays exact either way
      // (the nano fact-check matches numbers downstream).
      line:
        quoteLine ??
        `You have ${s.reviewSamplePartial === true ? "at least " : ""}${s.unansweredNegative} unanswered negative review${(s.unansweredNegative ?? 0) === 1 ? "" : "s"} — the kind ${noun} read before they call.`,
      why: quoteLine
        ? "Unanswered negative review (quoted verbatim)"
        : "Unanswered negative reviews (concrete, verifiable pain)",
    },
    {
      key: "review_decline",
      present: s.reviewLifecycle === "DYING" || s.reviewLifecycle === "DORMANT",
      severity: 70,
      // A4 · the COMPARATIVE claim ("while neighbors keep climbing") is gated
      // on a non-null reviewsVsCellPercentile — the live test shipped it with
      // the percentile null in every sample. No percentile → self-referential
      // copy only (own trend, no market claim).
      line:
        s.reviewsVsCellPercentile != null
          ? `Your review pace has been ${s.reviewLifecycle === "DORMANT" ? "quiet for months" : "slipping"} while neighbors keep climbing.`
          : s.reviewLifecycle === "DORMANT"
            ? `Your reviews have gone quiet for months.`
            : `Your review pace has been slipping.`,
      why:
        s.reviewsVsCellPercentile != null
          ? "Review momentum declining vs cell"
          : "Review momentum declining (own trend)",
    },
    {
      key: "ads_no_booking",
      present: s.runsAds === true && s.hasBookingTool === false,
      severity: 65,
      line: `You're paying for ads but there's no online booking — that's spend leaking to voicemail.`,
      why: "Running ads with no booking tool (measurable waste)",
    },
    {
      key: "slow_site",
      present: (s.lcpSeconds ?? 0) >= 4,
      severity: 55,
      // A7 · number + a GENERAL consequence (no fabricated %) — "most visitors
      // leave" is a plain truth, the 7.7s is real data.
      line: `Your site takes ${s.lcpSeconds?.toFixed(1)}s to load on mobile — most visitors leave before it opens.`,
      why: "Slow LCP (≥4s) — fixable conversion loss",
    },
    {
      key: "competitor_ads",
      present: (s.competitorAdsCount ?? 0) > 0 && s.runsAds !== true,
      severity: 50,
      // Count-only, worded to exactly what the signal proves: N advertisers in
      // this cell run ads while the prospect does not. INC-54 · we do NOT name a
      // rival or a keyword here — see competitorAdsLine for why that would be a
      // fabricated, disprovable claim.
      line: competitorAdsLine(s),
      why: "Competitors advertising while prospect is absent",
    },
    {
      key: "no_booking",
      present: s.hasBookingTool === false && s.runsAds !== true,
      severity: 40,
      // A7 · add the consequence — an after-hours booking is a lost
      // customer/patient. Plain truth, no fabricated number.
      line: `There's no way for ${noun} to book online from your site — after-hours, that's a lost ${noun === "patients" ? "patient" : noun === "clients" ? "client" : "customer"}.`,
      why: "No booking tool (relevant for booking-SaaS pitch)",
    },
  ];
}

const CANSPAM_BANNED = /\{\{[^}]+\}\}/; // any unfilled merge token

/** A first-touch must never ship with an unfilled merge token. */
export function hasUnfilledToken(body: string): boolean {
  return CANSPAM_BANNED.test(body);
}

/**
 * Append the legally-required email footer, branching on recipient country
 * (WP7-4, default FLIPPED by A11 · touchpoints audit 2026-07-07). BOTH regimes
 * require a physical mailing address + a working opt-out; throws without an
 * address (the setup gate makes the UI collect it).
 *
 *   - US            → CAN-SPAM (15 U.S.C. §7704(a)(5)): postal address +
 *     unsubscribe. Opt-OUT model — no prior consent needed to send.
 *   - CA / other / UNKNOWN → CASL (S.C. 2010, c.23): sender identification +
 *     consent-basis line + address + unsubscribe (s.6(2)(b) / s.11). The CASL
 *     footer is a compliant SUPERSET of CAN-SPAM, so it is the safe default
 *     when the country is null — pre-A11 an unknown-country CA lead silently
 *     got the shorter, CASL-non-compliant footer. Only a POSITIVE "US" gets
 *     the short form. The agency is responsible for having a lawful consent
 *     basis; the co-pilot surfaces this at generation time.
 *
 * `senderName` (the agency, when known) is used for the CASL sender-ID line.
 * A13 · without an unsubscribeUrl the opt-out line reads as a human reply ask
 * ("Just reply …"), not the SMS-flavored "Reply STOP" that flags automation.
 */
export function withCanSpamFooter(
  body: string,
  opts: {
    mailingAddress?: string | null;
    unsubscribeUrl?: string | null;
    country?: string | null;
    senderName?: string | null;
  },
): string {
  if (!opts.mailingAddress) {
    throw new Error(
      "[outreach] CAN-SPAM/CASL require a physical mailing address on email sends",
    );
  }
  const unsub = opts.unsubscribeUrl
    ? `Unsubscribe: ${opts.unsubscribeUrl}`
    : `Just reply "no" and I won't email again.`;

  // A11 · only a positive "US" takes the short CAN-SPAM footer; CA / other /
  // null all get the stricter CASL framing (compliant everywhere we send).
  const isUs = (opts.country ?? "").toUpperCase() === "US";
  if (!isUs) {
    // CASL: identify the sender, state the consent basis, address, unsubscribe.
    const who = opts.senderName?.trim()
      ? `This message is from ${opts.senderName.trim()}.`
      : "This is a commercial message.";
    return (
      `${body}\n\n—\n${who}\n` +
      `You're receiving this because your business is publicly listed and it ` +
      `appears relevant to your services; if that's not right, opt out below and ` +
      `we won't contact you again.\n` +
      `${opts.mailingAddress}\n${unsub}`
    );
  }

  return `${body}\n\n—\n${opts.mailingAddress}\n${unsub}`;
}

function tierFor(usedCount: number): PredictedTier {
  if (usedCount >= 3) return "high";
  if (usedCount === 2) return "medium";
  return "low";
}

/**
 * Opener line per tone + sequence step. Steps ≥2 read as follow-ups. A16 ·
 * step-1 openers carry 3 meaning-identical FRAME variants per tone, rotated
 * per business (variantSeed) — variant 0 is the pre-A16 canonical phrasing, so
 * un-seeded callers are byte-stable. Facts/grounding are untouched: the frame
 * only rewords "who I am"; A14 · the business name renders SHORT everywhere.
 */
function openerFor(
  signals: TouchSignals,
  opts: TouchOptions,
  step: number,
): string {
  const short = shortBusinessName(signals.businessName);
  if (step === 2) {
    return `Following up on my note about ${short} — one more thing I noticed.`;
  }
  if (step >= 3) {
    return `Last note from me on ${short} — I'll leave it here after this.`;
  }
  const around = signals.city ? ` around ${signals.city}` : "";
  const sells = opts.sellingWhat;
  const tone = opts.tone ?? "direct";
  // A10 · "who I help" — the grounded category when we have a clean one
  // ("acupuncture clinics"), else the generic "local businesses". Named form is
  // an ADDITIONAL variant, never variant 0, so un-seeded callers stay byte-stable.
  const who = signals.categoryLabel?.trim() || null;
  const variants: readonly string[] =
    tone === "warm"
      ? [
          `Hi — I help local businesses${around} with ${sells}, and I had a look at ${short}.`,
          `Hi — I recently had a look at ${short}; I help local businesses${around} with ${sells}.`,
          ...(who
            ? [
                `Hi — I help ${who}${around} with ${sells}, and I had a look at ${short}.`,
              ]
            : [
                `Hi — while helping local businesses${around} with ${sells}, I had a look at ${short}.`,
              ]),
        ]
      : tone === "brief"
        ? [
            `Hi — quick note about ${short}.`,
            `Hi — a small thing I noticed about ${short}.`,
            `Hi — one quick observation about ${short}.`,
          ]
        : [
            `Hi — I help local businesses${around} with ${sells}.`,
            `Hi — I spend my days helping local businesses${around} with ${sells}.`,
            ...(who
              ? [`Hi — I help ${who}${around} with ${sells}.`]
              : [
                  `Hi — I work with local businesses${around}, helping them with ${sells}.`,
                ]),
          ];
  return variants[
    variantIndex(opts.variantSeed, `opener:${tone}`, variants.length)
  ];
}

/**
 * Closing ask per sequence step. A14 · step 1's pain close rotates 4 grounded
 * interest-question CTA variants per business (the live test shipped the same
 * "Want a quick rundown of what I found for {FullLegalName}?" in 10/11
 * samples) — variant 0 keeps the canonical phrasing, the name renders SHORT,
 * and every variant is exactly one question.
 */
function closeFor(
  signals: TouchSignals,
  step: number,
  hasPain: boolean,
  variantSeed?: string | null,
): string {
  const short = shortBusinessName(signals.businessName);
  if (step === 2) {
    return `Worth a quick look? Happy to send over what I found.`;
  }
  if (step >= 3) {
    return `If the timing's wrong, no worries — the findings are yours either way. Want them?`;
  }
  if (!hasPain) {
    return `Mind if I send over a quick look at ${short}'s online presence?`;
  }
  const variants: readonly string[] = [
    `Want a quick rundown of what I found for ${short}?`,
    `Worth a quick look?`,
    `Want the 2-minute breakdown?`,
    `Open to seeing what I found?`,
  ];
  return variants[variantIndex(variantSeed, "cta", variants.length)];
}

// ── A1/A2/A3/A11 · subjects ──────────────────────────────────────────────────
//
// The audit's worst surface (3.3/10): subjects shipped the INTERNAL why-string
// ("Tommy Gun's Original Barbershop — review momentum declining vs cell",
// "… — slow lcp") byte-identical across a cohort. Then the founder's v2 mandate:
// LEAD with the SPECIFIC hook — the number, the name, the rank — so it reads
// like a person spotted one real thing, not a campaign. Contract:
//   - per pain theme, 2–4 deterministic variants — short, lowercase, specific
//     FIRST (the real number/name/rank when grounded), then plainer fallbacks
//     for cohort dedup; NO Mapsly vocabulary ("vs cell" / "lcp" / why-strings),
//     no full legal business name, no " — " (spaced em-dash reads templated)
//   - ≤50 chars ALWAYS (an interpolated variant that overflows falls through
//     to the next; every theme has a static variant that fits)
//   - A3 truthfulness (WA CEMA exposure): the subject derives ONLY from the top
//     CHOSEN pain — which is by construction in the body — or the generic
//     fallback; any NUMBER / NAME a variant interpolates uses the exact
//     formatting the body line uses, so subject claims are always body-backed
//   - A2 cohort dedup: the variant rotates per business (variantSeed)
//   - A12: the name toggle + Title Case are applied AFTER selection, in
//     subjectFor — the variants themselves stay lowercase + name-free

/** Max subject length (chars). */
const SUBJECT_MAX_CHARS = 50;

/**
 * A11/A3 · a > SUBJECT_MAX_CHARS sentinel a variant returns to DECLINE itself
 * (e.g. the numeric unanswered subject when the body quotes a review instead of
 * stating the count) — subjectFor's ≤50-char loop then falls through to the next
 * variant. 60 chars of 'x' can never be a real subject and never fits.
 */
const SUBJECT_SKIP = "x".repeat(SUBJECT_MAX_CHARS + 10);

const SUBJECT_VARIANTS: Record<
  PainThemeKey,
  readonly ((s: TouchSignals) => string)[]
> = {
  hipaa_pixel_risk: [
    () => `a privacy check for your booking page`,
    // Copy review B2 · avoid the compliance-scare register on a cold first
    // touch — "something to check" reads as a heads-up, not a threat.
    () => `something on your booking page to check`,
  ],
  unanswered_negative: [
    // A11/A3 · lead with the SPECIFIC count ONLY when the body uses the COUNT
    // line (not the quote). When the body QUOTES a review, the count is not in
    // the body — so putting it in the subject would break the body-backed
    // invariant. In the quote case this variant returns an over-length
    // placeholder so subjectFor's ≤50-char loop skips to the plain variants,
    // which reference "a review" (present in the quoted body).
    (s) => {
      if (s.recentUnansweredReviewQuote) return SUBJECT_SKIP;
      const n = s.unansweredNegative ?? 0;
      return `${n} review${n === 1 ? "" : "s"} waiting on a reply?`;
    },
    () => `a review with no reply yet`,
    () => `about your recent reviews`,
  ],
  review_decline: [
    () => `your review pace lately`,
    () => `fewer reviews coming in?`,
    () => `quiet on the review front`,
  ],
  ads_no_booking: [
    () => `your ads deserve a booking page`,
    () => `ad clicks with nowhere to book`,
  ],
  slow_site: [
    // A11 · lead with the REAL number ("your site's 7.7s load") — the specific
    // hook the founder wants. TWO of the three variants carry the number so the
    // cohort mostly ships a number-forward subject (dedup still rotates). The
    // LCP is formatted exactly as the body line (toFixed(1)) so the subject
    // number always matches the body (A3); the last plain variant covers the
    // null-LCP edge and adds cohort variety.
    (s) =>
      s.lcpSeconds != null
        ? `your site's ${s.lcpSeconds.toFixed(1)}s load`
        : `your site's load time`,
    (s) =>
      s.lcpSeconds != null
        ? `${s.lcpSeconds.toFixed(1)}s to load on mobile`
        : `your website feels slow on mobile`,
    () => `your site takes a while to load`,
  ],
  competitor_ads: [
    // INC-54 · curiosity-first, count-backed. We do NOT name a rival as an
    // advertiser (topRivalName is a Maps adjacency seed, not a verified
    // advertiser — naming it here would be a disprovable claim). The body line
    // is the grounded advertiser count.
    (s) => `others in ${s.city ?? "your area"} are advertising`,
    () => `who's running ads nearby`,
  ],
  no_booking: [
    () => `booking straight from your site`,
    () => `an easier way to get booked`,
  ],
};

/**
 * A12 · Title Case a subject for the name-on variant. Lowercases then
 * capitalizes each word's first letter, leaving interior punctuation intact.
 * Keeps a leading digit token as-is ("7.7s" → "7.7s"). Deterministic + pure.
 */
function titleCase(s: string): string {
  return s.replace(
    /\b([a-z])([a-z']*)/g,
    (_m, first: string, rest: string) => first.toUpperCase() + rest,
  );
}

/**
 * Subject line per step (email only). Follow-ups read as replies. Step 1
 * derives from the TOP CHOSEN pain's variant table (A11: the specific hook —
 * number/name/rank — first; A3: never claims beyond the body); a no-pain lead
 * keeps a plain generic subject with the SHORT name.
 *
 * A12 · `includeNameInSubject` (default false, the expert recommendation): OFF
 * keeps the lowercase, specific, no-name subject. ON prepends the SHORT business
 * name + Title-Cases the whole line ("Glow Spa — Your Site's 7.7s Load"); if the
 * name prefix would overflow ≤50 chars we keep the name-free specific subject
 * (the hook matters more than the name). Follow-up (step>1) subjects already
 * carry the name and are unchanged by the toggle.
 */
function subjectFor(
  signals: TouchSignals,
  step: number,
  chosen: PainLine[],
  variantSeed?: string | null,
  includeNameInSubject?: boolean,
): string {
  const short = shortBusinessName(signals.businessName);
  // Follow-ups read as replies and already name the business — the toggle
  // doesn't apply (they're never a lowercase specific-hook subject).
  if (step > 1) return `re: ${short} — a quick look`;

  const top = chosen[0];
  // Pick the specific, name-free, lowercase subject first.
  let base: string;
  if (!top) {
    base = `a quick look at ${short}`;
    if (base.length > SUBJECT_MAX_CHARS)
      base = `a quick look at your online presence`;
    // A generic subject already carries the short name — the toggle is a no-op.
    return includeNameInSubject ? titleCase(base) : base;
  } else {
    const variants = SUBJECT_VARIANTS[top.key as PainThemeKey];
    const start = variantIndex(
      variantSeed,
      `subject:${top.key}`,
      variants.length,
    );
    // ≤50-char guard: an interpolated variant (number / rival name / city) that
    // overflows — or a variant that DECLINED itself via SUBJECT_SKIP — falls
    // through to the next; every theme has a static variant that fits.
    base = `a quick look at your online presence`;
    for (let i = 0; i < variants.length; i += 1) {
      const candidate = variants[(start + i) % variants.length](signals);
      if (candidate.length <= SUBJECT_MAX_CHARS) {
        base = candidate;
        break;
      }
    }
  }

  // A12 · name OFF (default) → the lowercase specific subject as-is.
  if (!includeNameInSubject) return base;

  // A12 · name ON → "{ShortName} — {Title-Cased subject}" when it fits ≤50;
  // otherwise keep the name-free specific subject Title-Cased (the specific
  // hook still leads — a truncated name helps no one).
  const named = `${short} — ${base}`;
  return named.length <= SUBJECT_MAX_CHARS ? titleCase(named) : titleCase(base);
}

/**
 * A9 · STEP-2 DEEPENING — the #1 quality complaint. Today a follow-up on a lead
 * with only one pain ships an EMPTY body (opener + footer). This returns a
 * follow-up body fact that ADDS A NEW GROUNDED fact about the SAME primary issue
 * — a second real number, the named-rival RANK/keyword contrast, the specific
 * consequence, or the AI pain hypothesis — so a follow-up is never "just
 * following up." Returns null only when we genuinely have nothing new grounded
 * (then the caller falls back to the plain follow-up close).
 *
 * `primaryTheme` is the theme the sequence already pitched (from the first
 * excluded key, else the top present pain). Every returned string is REAL
 * per-business data; numbers are already in `signals` (nano fact-check safe).
 */
function stepTwoDeepen(
  primaryTheme: string | null,
  signals: TouchSignals,
): { line: string; why: string } | null {
  const noun = signals.noun || "customers";

  // A per-theme "second fact" that DIFFERS from the step-1 line for that theme.
  switch (primaryTheme) {
    case "slow_site": {
      // A second speed number: the mobile performance score (distinct from the
      // LCP seconds the step-1 line quoted). Only when grounded.
      if (signals.lighthousePerf != null) {
        return {
          line: `Its mobile speed score sits at ${Math.round(signals.lighthousePerf)}/100 — Google now factors that into where you rank.`,
          why: "Step-2 deepen · mobile performance score (new number)",
        };
      }
      break;
    }
    case "unanswered_negative": {
      // If step 1 used the COUNT, deepen with the QUOTE; if step 1 used the
      // QUOTE, deepen with the total count. Both are real, and NOT what step 1
      // said.
      const quote = signals.recentUnansweredReviewQuote?.trim();
      const stars = signals.reviewQuoteStars;
      // Heuristic: if a quote exists it was preferred at step 1 → deepen with the
      // count. Otherwise deepen with the (now-quoted) review if we have one.
      if (
        quote &&
        typeof stars === "number" &&
        (signals.unansweredNegative ?? 0) > 0
      ) {
        return {
          line: `And it's not just that one — ${signals.reviewSamplePartial ? "at least " : ""}${signals.unansweredNegative} negative review${(signals.unansweredNegative ?? 0) === 1 ? "" : "s"} ${(signals.unansweredNegative ?? 0) === 1 ? "sits" : "sit"} unanswered right now.`,
          why: "Step-2 deepen · total unanswered count (new number)",
        };
      }
      break;
    }
    // INC-54 · no competitor_ads-specific deepener. Both former lines were
    // fabrications: (1) the "Search '{category} {city}' and {packLeaderName}…"
    // splice — pack1Name is NOT attributable to the derived keyword (a second
    // writer, aggregate-cell-maps, sets pack1Name per TEMPLATE keyword, so the
    // named leader is routinely for a different query); (2) "{rival} is the name
    // Google keeps putting in front of you" — a ranking/precedence claim we have
    // no data for (topRivalName is a "people also search" ADJACENCY seed).
    // competitor_ads falls through to the grounded cross-theme fallbacks below.
    default:
      break;
  }

  // Cross-theme fallbacks, sharpest first — each a REAL per-business fact. Any
  // present signal yields a follow-up fact so a step-2 body is never empty when
  // the lead has anything grounded:
  // 1) the AI-derived pain hypothesis (a specific, grounded wedge),
  if (signals.aiPainHypothesis?.trim()) {
    return {
      line: endWithPeriod(
        `The other thing I spotted: ${lowerFirstChar(signals.aiPainHypothesis.trim())}`,
      ),
      why: "Step-2 deepen · AI pain hypothesis",
    };
  }
  // 2) the named-rival ADJACENCY contrast — honest: peopleAlsoSearch = "people
  //    also search for", so the rival turns up NEXT TO you in Google's results;
  //    NO ranking/precedence claim (INC-54).
  if (signals.topRivalName?.trim()) {
    return {
      line: `Worth knowing: ${signals.topRivalName.trim()} keeps turning up right next to you in the results your ${noun} see.`,
      why: "Step-2 deepen · named nearby rival",
    };
  }
  // 3) a second speed number even off a non-slow primary,
  if (signals.lighthousePerf != null) {
    return {
      line: `Its mobile speed score sits at ${Math.round(signals.lighthousePerf)}/100 — Google now factors that into where you rank.`,
      why: "Step-2 deepen · mobile performance score (new number)",
    };
  }
  // 4) a tenure fact — "N years on Google" is a real, specific hook.
  if (signals.yearsOnGoogle != null && signals.yearsOnGoogle >= 1) {
    return {
      line: `You've built ${signals.yearsOnGoogle} year${signals.yearsOnGoogle === 1 ? "" : "s"} of presence on Google — worth making sure the site does it justice.`,
      why: "Step-2 deepen · years on Google (tenure)",
    };
  }
  return null;
}

/** Lowercase the first character of a string (for mid-sentence insertion). */
function lowerFirstChar(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
}

/** A9 · ensure a deepener line ends in sentence punctuation (AI hypotheses come
 *  in without a terminal period). Leaves ? / ! / . as-is. */
function endWithPeriod(s: string): string {
  const t = s.trimEnd();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** A9 · the sharpest PRESENT pain key across all lines (severity-desc) — the
 *  fallback "primary theme" a deepener works from when no key was excluded and
 *  nothing is left present. Null when the lead has no present pain at all. */
function eligibleTopKey(lines: PainLine[]): string | null {
  const top = [...lines]
    .filter((l) => l.present)
    .sort((a, b) => b.severity - a.severity)[0];
  return top?.key ?? null;
}

/**
 * Build a signal-grounded first touch. Only present signals produce lines;
 * absent ones are dropped (recorded in `droppedTokens`). Never emits an
 * unfilled token. Email channel appends a CAN-SPAM footer (throws if no
 * mailing address).
 */
export function buildFirstTouch(
  signals: TouchSignals,
  opts: TouchOptions,
): FirstTouch {
  const step = Math.max(1, opts.sequenceStep ?? 1);
  const allowed =
    opts.allowedPainKeys && opts.allowedPainKeys.length > 0
      ? new Set(opts.allowedPainKeys)
      : null;
  const excluded = new Set(opts.excludePainKeys ?? []);

  // A7 · pitch-aware ranking: themes matching sellingWhat get +30 severity
  // (capped below the HIPAA band) so the agency's actual service leads when
  // its signal is present. Applied BEFORE ordering so the WP6-15 band rotation
  // operates on the boosted severities — still fully deterministic.
  const lines = applyPitchBoost(painLines(signals), opts.sellingWhat);
  const eligible = lines.filter(
    (l) =>
      l.present && (!allowed || allowed.has(l.key)) && !excluded.has(l.key),
  );
  // Sharpest-first, then WP6-15 per-agency rotation within each severity band
  // (no seed → the canonical severity-desc order).
  const present = orderPains(eligible, opts.agencySeed);
  const dropped = lines.filter((l) => !present.includes(l)).map((l) => l.key);

  const opener = openerFor(signals, opts, step);

  // Step 1 uses the top 1–2 sharpest grounded pains (keep it short = higher
  // reply); follow-up steps cite ONE fresh theme each so a 3-touch sequence
  // never repeats itself (WP5-10).
  const chosen = present.slice(0, step === 1 ? 2 : 1);

  // A9 · STEP-2 DEEPENING: on a follow-up with NO fresh pain left (the lead had
  // only one issue), don't ship an empty "just following up." Add a NEW grounded
  // fact about the SAME primary issue — the theme the sequence already pitched
  // (the first excluded key, else the top present pain). The deepener returns
  // null only when we truly have nothing new grounded, in which case the plain
  // follow-up close still carries the message.
  let painText = chosen.map((l) => l.line).join(" ");
  let deepenWhy: string | null = null;
  if (step >= 2 && chosen.length === 0) {
    const primaryTheme =
      opts.excludePainKeys?.[0] ?? present[0]?.key ?? eligibleTopKey(lines);
    const deepen = stepTwoDeepen(primaryTheme, signals);
    if (deepen) {
      painText = deepen.line;
      deepenWhy = deepen.why;
    }
  }

  const close = closeFor(signals, step, chosen.length > 0, opts.variantSeed);

  let body = [opener, painText, close].filter(Boolean).join("\n\n");

  if (opts.channel === "email") {
    // WP7-4 · footer branches on the RECIPIENT's country (CA → CASL framing).
    body = withCanSpamFooter(body, {
      mailingAddress: opts.mailingAddress,
      unsubscribeUrl: opts.unsubscribeUrl,
      country: signals.country,
      senderName: opts.senderName,
    });
  }

  if (hasUnfilledToken(body)) {
    throw new Error(
      "[outreach] refusing to ship a touch with an unfilled token",
    );
  }

  const subject =
    opts.channel === "email"
      ? subjectFor(
          signals,
          step,
          chosen,
          opts.variantSeed,
          opts.includeNameInSubject,
        )
      : undefined;

  // A9 · a step-2 deepen contributes a why-string (so the UI shows the follow-up
  // carried a real fact) but is NOT a pain theme key — it must NOT enter
  // usedSignals (that drives the WP5-10 non-repeat dedup; a deepen re-uses the
  // primary theme by design). why keeps the deepen reason for transparency.
  const why = [...chosen.map((l) => l.why), ...(deepenWhy ? [deepenWhy] : [])];

  return {
    subject,
    body,
    why,
    // Tier = personalization DEPTH (all grounded signals available), not just
    // the 1–2 lines we put in the body. More citable signals ⇒ higher reply.
    predictedTier: tierFor(present.length),
    usedSignals: chosen.map((l) => l.key),
    droppedTokens: dropped,
  };
}
