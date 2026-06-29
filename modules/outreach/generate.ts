// modules/outreach/generate.ts · signal-grounded outreach generation (Phase 8)
//
// Two pieces:
//   1. gatherTouchSignals(businessId) — assemble the REAL TouchSignals for one
//      prospect from Mapsly's own data (Business / latest BusinessSnapshot /
//      Review counts / latest LighthouseAudit / AdLibraryEntry / PlaybookFinding).
//      Every field is null/0 when we genuinely don't have it, so the downstream
//      skeleton (first-touch.ts) omits any line whose signal is absent.
//   2. generateTouchesForLeads(businessIds, opts) — build a FirstTouch per
//      business via buildFirstTouch and persist an OutreachDraft row each
//      (channel / subject / body / whyJson / predictedTier).
//
// DETERMINISTIC by design. Every line of every draft is bound to a real signal;
// the gpt-5.4-nano "fill" pass (fluency rewording of already-grounded lines, no
// new facts) is a SEPARATE, documented later step and is NOT invoked here.
//
// See:
//   - modules/outreach/first-touch.ts — buildFirstTouch / TouchSignals
//   - modules/cold/signals.ts          — sibling gatherer (cold path) for ref
//   - prisma/schema.prisma             — OutreachDraft

import prisma from "@/lib/prisma";

import { type TouchSignals } from "./first-touch";
import { buildChannelTouch, type OutreachChannel } from "./channels";

/** The channel the action exposes (UI selector). Mapped to the renderer's
 *  OutreachChannel so phone/social render as a call script / DM, not an email. */
export type GenerateChannel = "email" | "dm" | "phone" | "social";

function toOutreachChannel(c: GenerateChannel): OutreachChannel {
  switch (c) {
    case "email":
      return "email";
    case "phone":
      return "phone_script";
    case "social":
    case "dm":
    default:
      return "social_dm";
  }
}

/** Map of category → customer noun (mirrors modules/cold/signals.ts). */
function nounFor(category: string | null): string {
  const c = (category ?? "").toLowerCase();
  if (/med spa|medical|spa|aesthetic|derma|clinic|botox|laser|wellness/.test(c))
    return "patients";
  if (/salon|hair|nail|lash|barber|beauty/.test(c)) return "clients";
  return "customers";
}

/** Coerce the snapshot's reviewLifecycle string to the typed union (or null). */
function lifecycleOf(
  raw: string | null | undefined,
): TouchSignals["reviewLifecycle"] {
  switch (raw) {
    case "TRENDING":
    case "STABLE":
    case "DYING":
    case "DORMANT":
      return raw;
    default:
      return null;
  }
}

/**
 * Reviews-vs-cell percentile (0–100) derived from the reputation pillar rank
 * within the cell: percentile = (1 - (rank-1)/of) × 100. Null when we lack the
 * rank or denominator. Higher = better positioned vs neighbors.
 */
function reputationPercentile(
  pillarRanks: unknown,
  cellSize: number | null,
): number | null {
  const reputation = (
    pillarRanks as { reputation?: { rank?: number; of?: number } } | null
  )?.reputation;
  const rank = typeof reputation?.rank === "number" ? reputation.rank : null;
  const of =
    typeof reputation?.of === "number" ? reputation.of : (cellSize ?? null);
  if (rank === null || of === null || of <= 1) return null;
  const pct = (1 - (rank - 1) / of) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Gather the grounded TouchSignals for one business. Throws if the business id
 * does not resolve (caller decides how to handle a deleted row).
 */
export async function gatherTouchSignals(
  businessId: string,
): Promise<TouchSignals> {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      city: true,
      category: true,
      snapshots: {
        take: 1,
        orderBy: { snapshotDate: "desc" },
        select: {
          reviewLifecycle: true,
          pillarRanks: true,
          cellSize: true,
          adsApplicable: true,
        },
      },
      lighthouseAudits: {
        take: 1,
        orderBy: { auditedAt: "desc" },
        select: { lcp: true, performance: true },
      },
    },
  });
  if (!biz) throw new Error(`[outreach] business not found: ${businessId}`);

  const snap = biz.snapshots[0] ?? null;
  const lh = biz.lighthouseAudits[0] ?? null;

  // Review counts (unanswered negatives) + competitor ad presence + own ads +
  // booking tech + HIPAA finding, in parallel.
  const [unansweredNegative, ownAds, bookingTech, hipaaFinding] =
    await Promise.all([
      prisma.review.count({
        where: { businessId, ownerReplied: false, stars: { lte: 2 } },
      }),
      prisma.adLibraryEntry.count({ where: { businessId, isActive: true } }),
      prisma.businessTech.findFirst({
        where: { businessId, category: "BOOKING" },
        select: { id: true },
      }),
      prisma.playbookFinding.findFirst({
        where: {
          businessId,
          signalKey: "hipaa-pixel-on-phi-page",
          status: "flagged",
        },
        select: { id: true },
      }),
    ]);

  // Tech enrichment ran iff there is any BusinessTech row. Only then can we make
  // a TRUE/FALSE booking claim; otherwise hasBookingTool stays null ("unknown").
  const techScanned = await prisma.businessTech.count({
    where: { businessId },
  });
  const hasBookingTool: boolean | null =
    techScanned === 0 ? null : bookingTech !== null;

  const runsAds = ownAds > 0;

  return {
    businessName: biz.name,
    city: biz.city,
    noun: nounFor(biz.category),
    unansweredNegative: unansweredNegative > 0 ? unansweredNegative : null,
    reviewLifecycle: lifecycleOf(snap?.reviewLifecycle),
    reviewsVsCellPercentile: reputationPercentile(
      snap?.pillarRanks ?? null,
      snap?.cellSize ?? null,
    ),
    lcpSeconds: typeof lh?.lcp === "number" ? lh.lcp : null,
    lighthousePerf: typeof lh?.performance === "number" ? lh.performance : null,
    // Competitor ad count is a cell-level read we don't fetch here (cheap path);
    // leave null so the skeleton omits the competitor-ads line unless provided.
    competitorAdsCount: null,
    runsAds,
    hasBookingTool,
    hipaaPixelRisk: hipaaFinding !== null ? true : null,
  };
}

/** Options for a batch generation run. */
export interface GenerateTouchesOptions {
  /** What the agency is selling (appears in the opener). */
  sellingWhat: string;
  channel: GenerateChannel;
  /** Required for email per CAN-SPAM (physical address). */
  mailingAddress?: string | null;
  unsubscribeUrl?: string | null;
  /** Associate the drafts with a campaign (optional). */
  campaignId?: string | null;
}

/** One generated draft pointer. */
export interface GeneratedTouch {
  businessId: string;
  draftId: string;
}

/**
 * Generate + persist a first-touch OutreachDraft for each business. Gathers
 * grounded signals, builds the deterministic skeleton, and writes the row.
 *
 * Resilient per-business: a business that cannot be gathered (deleted, or — for
 * email — missing CAN-SPAM address which makes buildFirstTouch throw) is SKIPPED
 * and omitted from the result, not allowed to fail the whole batch.
 */
export async function generateTouchesForLeads(
  businessIds: string[],
  opts: GenerateTouchesOptions,
): Promise<GeneratedTouch[]> {
  const out: GeneratedTouch[] = [];
  const channel = toOutreachChannel(opts.channel);

  for (const businessId of businessIds) {
    let touch: ReturnType<typeof buildChannelTouch>;
    try {
      const signals = await gatherTouchSignals(businessId);
      // Channel-aware: email → full skeleton + CAN-SPAM footer; phone → call
      // script; social/dm → short DM. (Was buildFirstTouch — phone/social
      // rendered as an email.)
      touch = buildChannelTouch(signals, {
        channel,
        sellingWhat: opts.sellingWhat,
        mailingAddress: opts.mailingAddress ?? null,
        unsubscribeUrl: opts.unsubscribeUrl ?? null,
      });
    } catch {
      // Ungroundable / unbuildable prospect → skip (never ship a bad touch).
      continue;
    }

    const draft = await prisma.outreachDraft.create({
      data: {
        businessId,
        campaignId: opts.campaignId ?? null,
        channel,
        subject: touch.subject ?? null,
        body: touch.body,
        whyJson: {
          why: touch.why,
          usedSignals: touch.usedSignals,
          droppedTokens: touch.droppedTokens,
        },
        predictedTier: touch.predictedTier,
        status: "draft",
      },
      select: { id: true },
    });
    out.push({ businessId, draftId: draft.id });
  }

  return out;
}
