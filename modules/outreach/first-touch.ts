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
   * WP7-4 · recipient country ("US" | "CA" | other | null). Drives the
   * compliance-footer branch: CA → CASL framing (consent basis + sender ID +
   * address + unsubscribe), everything else → CAN-SPAM (address + unsubscribe).
   * Null → CAN-SPAM (the strict-safe default for the US-majority index).
   */
  country?: string | null;
  /** WP7-4 · the business's public email (for the ConsentRecord basis). */
  recipientEmail?: string | null;
  noun?: string | null; // audience noun ("patients", "guests", "customers")
  unansweredNegative?: number | null;
  reviewLifecycle?: "TRENDING" | "STABLE" | "DYING" | "DORMANT" | null;
  reviewsVsCellPercentile?: number | null; // 0–100
  lcpSeconds?: number | null;
  lighthousePerf?: number | null; // 0–100
  competitorAdsCount?: number | null; // rivals advertising in the cell
  runsAds?: boolean | null;
  hasBookingTool?: boolean | null;
  hipaaPixelRisk?: boolean | null;
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
 *   band 2 — < 60   (slow site / competitor ads / no booking)
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

/** Build the candidate pain lines, each gated by signal presence. */
function painLines(s: TouchSignals): PainLine[] {
  const noun = s.noun || "customers";
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
      line: `You have ${s.unansweredNegative} unanswered negative review${(s.unansweredNegative ?? 0) === 1 ? "" : "s"} — the kind ${noun} read before they call.`,
      why: "Unanswered negative reviews (concrete, verifiable pain)",
    },
    {
      key: "review_decline",
      present: s.reviewLifecycle === "DYING" || s.reviewLifecycle === "DORMANT",
      severity: 70,
      line: `Your review pace has been ${s.reviewLifecycle === "DORMANT" ? "quiet for months" : "slipping"} while neighbors keep climbing.`,
      why: "Review momentum declining vs cell",
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
      line: `Your site takes ${s.lcpSeconds?.toFixed(1)}s to load on mobile — most visitors leave before it finishes.`,
      why: "Slow LCP (≥4s) — fixable conversion loss",
    },
    {
      key: "competitor_ads",
      present: (s.competitorAdsCount ?? 0) > 0 && s.runsAds !== true,
      severity: 50,
      line: `${s.competitorAdsCount} competitor${(s.competitorAdsCount ?? 0) === 1 ? " is" : "s are"} running ads in ${s.city || "your area"} — you're not showing up.`,
      why: "Competitors advertising while prospect is absent",
    },
    {
      key: "no_booking",
      present: s.hasBookingTool === false && s.runsAds !== true,
      severity: 40,
      line: `There's no way for ${noun} to book online from your site.`,
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
 * (WP7-4). BOTH regimes require a physical mailing address + a working opt-out;
 * throws without an address (the setup gate makes the UI collect it).
 *
 *   - US / unknown → CAN-SPAM (15 U.S.C. §7704(a)(5)): postal address +
 *     unsubscribe. Opt-OUT model — no prior consent needed to send.
 *   - CA           → CASL (S.C. 2010, c.23): CASL is a consent (opt-IN) regime,
 *     so the footer additionally states the sender-identification + the consent
 *     basis line, alongside the address + unsubscribe (s.6(2)(b) / s.11). The
 *     agency is responsible for having a lawful consent basis; the co-pilot
 *     surfaces this at generation time (see the CA interstitial in actions).
 *
 * `senderName` (the agency, when known) is used for the CASL sender-ID line.
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
    : "Reply STOP to opt out.";

  const isCanada = (opts.country ?? "").toUpperCase() === "CA";
  if (isCanada) {
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

/** Opener line per tone + sequence step. Steps ≥2 read as follow-ups. */
function openerFor(
  signals: TouchSignals,
  opts: TouchOptions,
  step: number,
): string {
  if (step === 2) {
    return `Following up on my note about ${signals.businessName} — one more thing I noticed.`;
  }
  if (step >= 3) {
    return `Last note from me on ${signals.businessName} — I'll leave it here after this.`;
  }
  const around = signals.city ? ` around ${signals.city}` : "";
  switch (opts.tone ?? "direct") {
    case "warm":
      return `Hi — I help ${opts.sellingWhat} businesses${around}, and I had a look at ${signals.businessName}.`;
    case "brief":
      return `Hi — quick note about ${signals.businessName}.`;
    case "direct":
    default:
      return signals.city
        ? `Hi — I work with ${opts.sellingWhat} businesses around ${signals.city}.`
        : `Hi — I work with ${opts.sellingWhat} businesses.`;
  }
}

/** Closing ask per sequence step. */
function closeFor(
  signals: TouchSignals,
  step: number,
  hasPain: boolean,
): string {
  if (step === 2) {
    return `Worth a quick look? Happy to send over what I found.`;
  }
  if (step >= 3) {
    return `If the timing's wrong, no worries — the findings are yours either way. Want them?`;
  }
  return hasPain
    ? `Want a quick rundown of what I found for ${signals.businessName}?`
    : `Mind if I send over a quick look at ${signals.businessName}'s online presence?`;
}

/** Subject line per step (email only). Follow-ups read as replies. */
function subjectFor(
  signals: TouchSignals,
  step: number,
  chosen: PainLine[],
): string {
  if (step > 1) return `re: ${signals.businessName} — a quick look`;
  return chosen.length > 0
    ? `${signals.businessName} — ${chosen[0].why.split("(")[0].trim().toLowerCase()}`
    : `A quick look at ${signals.businessName}`;
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

  const lines = painLines(signals);
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
  const painText = chosen.map((l) => l.line).join(" ");
  const close = closeFor(signals, step, chosen.length > 0);

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
    opts.channel === "email" ? subjectFor(signals, step, chosen) : undefined;

  return {
    subject,
    body,
    why: chosen.map((l) => l.why),
    // Tier = personalization DEPTH (all grounded signals available), not just
    // the 1–2 lines we put in the body. More citable signals ⇒ higher reply.
    predictedTier: tierFor(present.length),
    usedSignals: chosen.map((l) => l.key),
    droppedTokens: dropped,
  };
}
