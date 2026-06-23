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

export interface TouchOptions {
  sellingWhat: string; // what the agency offers
  channel: TouchChannel;
  /** Required for email per CAN-SPAM (postal address). */
  mailingAddress?: string | null;
  unsubscribeUrl?: string | null;
}

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

/** For email, enforce a CAN-SPAM footer (physical address + unsubscribe). */
export function withCanSpamFooter(
  body: string,
  opts: { mailingAddress?: string | null; unsubscribeUrl?: string | null },
): string {
  if (!opts.mailingAddress) {
    throw new Error(
      "[outreach] CAN-SPAM requires a physical mailing address on email sends",
    );
  }
  const unsub = opts.unsubscribeUrl
    ? `Unsubscribe: ${opts.unsubscribeUrl}`
    : "Reply STOP to opt out.";
  return `${body}\n\n—\n${opts.mailingAddress}\n${unsub}`;
}

function tierFor(usedCount: number): PredictedTier {
  if (usedCount >= 3) return "high";
  if (usedCount === 2) return "medium";
  return "low";
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
  const lines = painLines(signals);
  const present = lines
    .filter((l) => l.present)
    .sort((a, b) => b.severity - a.severity);
  const dropped = lines.filter((l) => !l.present).map((l) => l.key);

  const opener = signals.city
    ? `Hi — I work with ${opts.sellingWhat} businesses around ${signals.city}.`
    : `Hi — I work with ${opts.sellingWhat} businesses.`;

  // Use the top 1–2 sharpest grounded pains (keep it short = higher reply).
  const chosen = present.slice(0, 2);
  const painText = chosen.map((l) => l.line).join(" ");
  const close =
    chosen.length > 0
      ? `Want a quick rundown of what I found for ${signals.businessName}?`
      : `Mind if I send over a quick look at ${signals.businessName}'s online presence?`;

  let body = [opener, painText, close].filter(Boolean).join("\n\n");

  if (opts.channel === "email") {
    body = withCanSpamFooter(body, opts);
  }

  if (hasUnfilledToken(body)) {
    throw new Error(
      "[outreach] refusing to ship a touch with an unfilled token",
    );
  }

  const subject =
    opts.channel === "email"
      ? chosen.length > 0
        ? `${signals.businessName} — ${chosen[0].why.split("(")[0].trim().toLowerCase()}`
        : `A quick look at ${signals.businessName}`
      : undefined;

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
