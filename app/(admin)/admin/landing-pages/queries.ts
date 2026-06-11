/**
 * /admin/landing-pages · server queries.
 *
 * The conversion funnel for the personalized landing pages, shown RAW and
 * HUMAN-ONLY side by side (plan #17). "Human" is the shared definition from
 * lib/bot-detect.classifyLandingVisit — page open + ≥1 SECTION_VIEWED from a
 * non-scanner UA — applied over PER-SESSION aggregates so the classification
 * is re-derived from raw events on every load (heuristics can evolve without
 * a backfill).
 *
 * Gate inputs (lib/funnel-thresholds) come from the same summary plus the
 * ColdSend delivered count. The enum column comparisons stay inside SQL; all
 * outputs are bool/int/text casts per the Neon-adapter caution (INC-08).
 *
 * No `'use cache'` — the page marks itself dynamic via `connection()` and reads
 * fresh on every load (admin surface, low traffic).
 */

import prisma from "@/lib/prisma";
import { classifyLandingVisit, type BotReason } from "@/lib/bot-detect";
import {
  evaluateFunnelGates,
  type FunnelCounts,
  type GateResult,
  VERDICT_MIN_SENDS,
} from "@/lib/funnel-thresholds";

// ─── Per-session aggregate (raw SQL → pure classification) ─────────────────

/** One landing session, aggregated. The unit lib/bot-detect classifies. */
export interface LandingSessionAgg {
  /** sessionId, or a synthetic per-event key when the beacon had none. */
  sessionKey: string;
  /** Client-minted anonymous id — unique-visitor key (falls back to sessionKey). */
  visitorId: string | null;
  userAgent: string;
  hasPageOpened: boolean;
  sectionViews: number;
  pastHero: boolean;
  reachedPricing: boolean;
  ctaClicked: boolean;
  freeSignup: boolean;
  checkoutOpened: boolean;
  /** SUBSCRIPTION_BOUGHT events in this session (count, server-emitted). */
  subscribedCount: number;
}

/** One funnel step with both traffic views (unique visitors each). */
export interface FunnelStepSplit {
  id: "opened" | "section" | "engaged" | "checkout" | "subscribed";
  label: string;
  /** All traffic, bots included. */
  raw: number;
  /** Human-classified visitors only (classifyLandingVisit). */
  human: number;
}

export interface LandingFunnel {
  steps: FunnelStepSplit[];
  /** Sessions in total / classified non-human, by reason (#17b stats). */
  sessions: number;
  nonHumanSessions: number;
  botReasons: Partial<Record<BotReason, number>>;
  /** Section depth among HUMAN visitors — diagnoses the page_to_engaged gate. */
  sectionDepth: { pastHero: number; reachedPricing: number };
  /** Gate numerators (human-only by contract — lib/funnel-thresholds). */
  humanPageVisits: number;
  humanEngaged: number;
  paid: number;
}

export const EMPTY_FUNNEL: LandingFunnel = {
  steps: [
    { id: "opened", label: "Page opened", raw: 0, human: 0 },
    { id: "section", label: "Viewed ≥1 section", raw: 0, human: 0 },
    { id: "engaged", label: "CTA / free signup", raw: 0, human: 0 },
    { id: "checkout", label: "Checkout opened", raw: 0, human: 0 },
    { id: "subscribed", label: "Subscribed", raw: 0, human: 0 },
  ],
  sessions: 0,
  nonHumanSessions: 0,
  botReasons: {},
  sectionDepth: { pastHero: 0, reachedPricing: 0 },
  humanPageVisits: 0,
  humanEngaged: 0,
  paid: 0,
};

/**
 * Pure funnel math over classified sessions — exported for unit tests.
 *
 * Unique-visitor key = visitorId when the client minted one, else the
 * session key (so beacon-blind sessions still count once, never zero/twice).
 * A VISITOR is human when ≥1 of their sessions classifies human; their step
 * flags union across sessions. "Subscribed" is server-emitted truth (Stripe
 * webhook) so raw = human = event count there.
 */
export function summarizeLandingSessions(
  sessions: LandingSessionAgg[],
): LandingFunnel {
  type VisitorAgg = {
    human: boolean;
    opened: boolean;
    section: boolean;
    engaged: boolean;
    checkout: boolean;
    pastHero: boolean;
    reachedPricing: boolean;
  };
  const visitors = new Map<string, VisitorAgg>();
  const botReasons: Partial<Record<BotReason, number>> = {};
  let nonHumanSessions = 0;
  let paid = 0;

  for (const s of sessions) {
    const verdict = classifyLandingVisit({
      hasPageOpened: s.hasPageOpened,
      sectionViewedCount: s.sectionViews,
      userAgent: s.userAgent,
    });
    if (!verdict.isHuman) {
      nonHumanSessions++;
      if (verdict.reason) {
        botReasons[verdict.reason] = (botReasons[verdict.reason] ?? 0) + 1;
      }
    }
    paid += s.subscribedCount;

    const key = s.visitorId ?? s.sessionKey;
    const v = visitors.get(key) ?? {
      human: false,
      opened: false,
      section: false,
      engaged: false,
      checkout: false,
      pastHero: false,
      reachedPricing: false,
    };
    v.human ||= verdict.isHuman;
    v.opened ||= s.hasPageOpened;
    v.section ||= s.sectionViews > 0;
    v.engaged ||= s.ctaClicked || s.freeSignup;
    v.checkout ||= s.checkoutOpened;
    v.pastHero ||= s.pastHero;
    v.reachedPricing ||= s.reachedPricing;
    visitors.set(key, v);
  }

  const all = [...visitors.values()];
  const humans = all.filter((v) => v.human);
  const count = (
    pool: VisitorAgg[],
    flag: Exclude<keyof VisitorAgg, "human">,
  ) => pool.filter((v) => v[flag]).length;

  const humanPageVisits = count(humans, "opened");
  const humanEngaged = count(humans, "engaged");

  return {
    steps: [
      {
        id: "opened",
        label: "Page opened",
        raw: count(all, "opened"),
        human: humanPageVisits,
      },
      {
        id: "section",
        label: "Viewed ≥1 section",
        raw: count(all, "section"),
        human: count(humans, "section"),
      },
      {
        id: "engaged",
        label: "CTA / free signup",
        raw: count(all, "engaged"),
        human: humanEngaged,
      },
      {
        id: "checkout",
        label: "Checkout opened",
        raw: count(all, "checkout"),
        human: count(humans, "checkout"),
      },
      // Server-emitted (Stripe webhook) — inherently human, raw = human.
      { id: "subscribed", label: "Subscribed", raw: paid, human: paid },
    ],
    sessions: sessions.length,
    nonHumanSessions,
    botReasons,
    sectionDepth: {
      pastHero: count(humans, "pastHero"),
      reachedPricing: count(humans, "reachedPricing"),
    },
    humanPageVisits,
    humanEngaged,
    paid,
  };
}

interface SessionRow {
  session_key: string;
  visitor_id: string | null;
  user_agent: string;
  has_page_opened: boolean;
  section_views: number;
  past_hero: boolean;
  reached_pricing: boolean;
  cta_clicked: boolean;
  free_signup: boolean;
  checkout_opened: boolean;
  subscribed_count: number;
}

export async function getLandingFunnel(): Promise<LandingFunnel> {
  // GROUP BY session; sessionless rows (server-emitted events without a
  // sessionId) each stand alone via the synthetic `evt:` key. Counts cast
  // ::int per INC-08. LIMIT bounds the scan — at cold-email scale (hundreds
  // of landings) this is far above any realistic session count.
  const rows = await prisma.$queryRaw<SessionRow[]>`
    SELECT COALESCE("sessionId", 'evt:' || id)            AS session_key,
           MAX("visitorId")                               AS visitor_id,
           COALESCE(MAX("userAgent"), '')                 AS user_agent,
           BOOL_OR(type = 'PAGE_OPENED')                  AS has_page_opened,
           COUNT(*) FILTER (WHERE type = 'SECTION_VIEWED')::int AS section_views,
           BOOL_OR(type = 'SECTION_VIEWED' AND section <> 'hero')  AS past_hero,
           BOOL_OR(type = 'SECTION_VIEWED' AND section = 'pricing') AS reached_pricing,
           BOOL_OR(type = 'CTA_CLICKED')                  AS cta_clicked,
           BOOL_OR(type = 'FREE_SIGNUP')                  AS free_signup,
           BOOL_OR(type = 'CHECKOUT_OPENED')              AS checkout_opened,
           COUNT(*) FILTER (WHERE type = 'SUBSCRIPTION_BOUGHT')::int AS subscribed_count
    FROM "LandingEvent"
    GROUP BY COALESCE("sessionId", 'evt:' || id)
    LIMIT 50000
  `;

  return summarizeLandingSessions(
    rows.map((r) => ({
      sessionKey: r.session_key,
      visitorId: r.visitor_id,
      userAgent: r.user_agent,
      hasPageOpened: r.has_page_opened,
      sectionViews: r.section_views,
      pastHero: r.past_hero,
      reachedPricing: r.reached_pricing,
      ctaClicked: r.cta_clicked,
      freeSignup: r.free_signup,
      checkoutOpened: r.checkout_opened,
      subscribedCount: r.subscribed_count,
    })),
  );
}

// ─── Funnel gates (plan #17 thresholds) ─────────────────────────────────────

export interface FunnelGateView {
  results: GateResult[];
  /** ColdSend SENT minus hard bounces — the email_to_page denominator. */
  delivered: number;
  /** All SENT sends — drives the 2–3k verdict window. */
  totalSent: number;
  verdict: GateVerdict;
}

export type GateVerdict =
  | "no-data" // nothing measurable yet
  | "pass" // every gate with data passes
  | "fail-early" // ≥1 gate failing, still before the verdict window
  | "fallback"; // ≥1 gate failing at ≥ VERDICT_MIN_SENDS — fallback plan time

/** Pure verdict logic — exported for unit tests. */
export function gateVerdict(
  totalSent: number,
  results: GateResult[],
): GateVerdict {
  const withData = results.filter((r) => r.pass != null);
  if (withData.length === 0) return "no-data";
  if (withData.every((r) => r.pass)) return "pass";
  return totalSent >= VERDICT_MIN_SENDS ? "fallback" : "fail-early";
}

export async function getFunnelGates(
  funnel: LandingFunnel,
): Promise<FunnelGateView> {
  // "Delivered" = SENT minus hard bounces. SMTP-time hard bounces are FAILED
  // (never SENT); any path that stamps bounceReason on a SENT row is excluded
  // here. Post-send NDRs currently mark the ColdRecipient (inbound poller),
  // not the send — so this is a slight upper bound, which only makes the
  // email_to_page gate STRICTER. Fine.
  const [delivered, totalSent] = await Promise.all([
    prisma.coldSend.count({ where: { status: "SENT", bounceReason: null } }),
    prisma.coldSend.count({ where: { status: "SENT" } }),
  ]);

  const counts: FunnelCounts = {
    delivered,
    humanPageVisits: funnel.humanPageVisits,
    humanEngaged: funnel.humanEngaged,
    paid: funnel.paid,
  };
  const results = evaluateFunnelGates(counts);
  return {
    results,
    delivered,
    totalSent,
    verdict: gateVerdict(totalSent, results),
  };
}

// ─── Landings list ──────────────────────────────────────────────────────────

export interface LandingRow {
  id: string;
  token: string;
  slug: string;
  isActive: boolean;
  viewCount: number;
  createdAt: Date;
  businessName: string;
  businessCity: string | null;
  conversions: number;
}

export async function getLandingPagesList(): Promise<LandingRow[]> {
  const [landings, subs] = await Promise.all([
    prisma.landingPage.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        token: true,
        slug: true,
        isActive: true,
        viewCount: true,
        createdAt: true,
        business: { select: { name: true, city: true } },
      },
    }),
    prisma.landingEvent.groupBy({
      by: ["landingPageId"],
      where: { type: "SUBSCRIPTION_BOUGHT" },
      _count: { _all: true },
    }),
  ]);

  const subMap = new Map(subs.map((s) => [s.landingPageId, s._count._all]));

  return landings.map((l) => ({
    id: l.id,
    token: l.token,
    slug: l.slug,
    isActive: l.isActive,
    viewCount: l.viewCount,
    createdAt: l.createdAt,
    businessName: l.business.name,
    businessCity: l.business.city,
    conversions: subMap.get(l.id) ?? 0,
  }));
}
