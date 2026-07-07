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

import { type TouchSignals, type TouchTone } from "./first-touch";
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

/**
 * Normalize a business country to an uppercase ISO-ish 2-letter code (US / CA).
 * DfS + our gazetteer store "US"/"CA"; guard against a full name or lowercase.
 * Null when we genuinely don't know — the footer then defaults to the CASL
 * long form (A11 · touchpoints audit 2026-07-07): CASL is a compliant SUPERSET
 * of CAN-SPAM, so an unknown-country lead (possibly Canadian) always gets the
 * stricter footer; only a positive "US" takes the short CAN-SPAM form.
 */
function normalizeCountry(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s === "US" || s === "USA" || s === "UNITED STATES") return "US";
  if (s === "CA" || s === "CAN" || s === "CANADA") return "CA";
  return s.slice(0, 2) || null;
}

/**
 * Map of category → customer noun. A6 (touchpoints audit 2026-07-07): the live
 * test handed an acupuncture clinic "customers" — health-practice categories
 * (acupuncture / chiropractic / dental / physio / medical / clinic / wellness)
 * say "patients"; salon-class categories (incl. plain day spas — med spas stay
 * "patients" via the med/medical match, tested first) say "clients";
 * everything else falls back to "customers".
 */
function nounFor(category: string | null): string {
  const c = (category ?? "").toLowerCase();
  if (
    /acupunctur|chiropract|dental|dentist|physio|med spa|medical|aesthetic|derma|clinic|botox|laser|wellness|health/.test(
      c,
    )
  )
    return "patients";
  if (/salon|hair|nail|lash|barber|beauty|spa/.test(c)) return "clients";
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
      country: true,
      email: true,
      category: true,
      // A5 · the LISTING's review count (vs our pulled rows) → partial-pull flag.
      reviewCount: true,
      // A10 · cell scope for the newest Meta AdMarketRun (competitor ad count).
      cellKey: true,
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

  // Review counts (unanswered negatives + total pulled rows for the A5
  // partial-pull flag) + own ads + booking tech + HIPAA finding + the cell's
  // newest verified Meta ad-market run (A10), in parallel.
  const [
    unansweredNegative,
    pulledReviews,
    ownAds,
    bookingTech,
    hipaaFinding,
    adMarket,
  ] = await Promise.all([
    prisma.review.count({
      where: { businessId, ownerReplied: false, stars: { lte: 2 } },
    }),
    prisma.review.count({ where: { businessId } }),
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
    // A10 · newest Meta run that actually produced data (OK/PARTIAL — same
    // freshness-anchor rule as modules/cell-intel/freshness.ts). One indexed
    // findFirst per business (batch ≤25). No cellKey / no run → null below.
    biz.cellKey
      ? prisma.adMarketRun.findFirst({
          where: {
            cellKey: biz.cellKey,
            platform: "META",
            status: { in: ["OK", "PARTIAL"] },
          },
          orderBy: { ranAt: "desc" },
          select: { advertiserCount: true },
        })
      : Promise.resolve(null),
  ]);

  // Tech enrichment ran iff there is any BusinessTech row. Only then can we make
  // a TRUE/FALSE booking claim; otherwise hasBookingTool stays null ("unknown").
  const techScanned = await prisma.businessTech.count({
    where: { businessId },
  });
  const hasBookingTool: boolean | null =
    techScanned === 0 ? null : bookingTech !== null;

  const runsAds = ownAds > 0;

  // A5 · partial-pull flag: our pulled rows cover meaningfully less than the
  // listing's own reviewCount (< 80%) → the unanswered-negative line reads
  // "at least N" instead of an exact claim the owner can disprove.
  const listingReviews =
    typeof biz.reviewCount === "number" ? biz.reviewCount : null;
  const reviewSamplePartial =
    listingReviews !== null &&
    listingReviews > pulledReviews &&
    pulledReviews < 0.8 * listingReviews;

  // A10 · competitor ad count from the cell's newest verified Meta run —
  // advertisers in the cell minus the business itself when it advertises
  // (never below 0). Null when there's no cellKey or no OK/PARTIAL run: the
  // competitor_ads pain honestly stays off. (Pre-A10 this was hardcoded null,
  // leaving the theme permanently dead while the UI still offered it.)
  const competitorAdsCount = adMarket
    ? Math.max(0, adMarket.advertiserCount - (runsAds ? 1 : 0))
    : null;

  return {
    businessName: biz.name,
    city: biz.city,
    // WP7-4 / A11 · country drives the footer branch (US → CAN-SPAM short;
    // CA / other / null → CASL superset). Normalized to an uppercase 2-letter
    // code; null when unknown.
    country: normalizeCountry(biz.country),
    recipientEmail: biz.email ?? null,
    noun: nounFor(biz.category),
    unansweredNegative: unansweredNegative > 0 ? unansweredNegative : null,
    reviewSamplePartial,
    reviewLifecycle: lifecycleOf(snap?.reviewLifecycle),
    reviewsVsCellPercentile: reputationPercentile(
      snap?.pillarRanks ?? null,
      snap?.cellSize ?? null,
    ),
    lcpSeconds: typeof lh?.lcp === "number" ? lh.lcp : null,
    lighthousePerf: typeof lh?.performance === "number" ? lh.performance : null,
    competitorAdsCount,
    runsAds,
    hasBookingTool,
    hipaaPixelRisk: hipaaFinding !== null ? true : null,
  };
}

/** Hard cap on sequence length (WP5-10). */
export const MAX_SEQUENCE_LENGTH = 3;

/** Options for a batch generation run. */
export interface GenerateTouchesOptions {
  /** What the agency is selling (appears in the opener). */
  sellingWhat: string;
  channel: GenerateChannel;
  /**
   * Owning agency — REQUIRED (WP0-1 / WP5 draft security). Every created
   * OutreachDraft is stamped with this so reads/mutations can filter by
   * agencyId instead of the legacy shared-cellKey walk.
   */
  agencyId: string;
  /** Required for email per CAN-SPAM / CASL (physical address). */
  mailingAddress?: string | null;
  unsubscribeUrl?: string | null;
  /** WP7-4 · sending agency name — CASL sender-ID footer line (CA recipients). */
  senderName?: string | null;
  /** Associate the drafts with a campaign (optional). */
  campaignId?: string | null;
  /** Voice variant (WP5-1). Defaults to "direct". */
  tone?: TouchTone;
  /**
   * Steps per business (1–3, WP5-10). Each step is its own OutreachDraft with
   * `whyJson.sequenceStep`/`sequenceOf` (no schema step column — documented in
   * TouchpointsTab). Pain themes never repeat across a business's steps.
   */
  sequenceLength?: number;
  /** Restrict pain themes to these keys (WP5-1 pain multipicker). */
  painPointKeys?: readonly string[];
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
): Promise<{
  touches: GeneratedTouch[];
  skippedNoAddress: number;
  skippedSparse: number;
}> {
  const out: GeneratedTouch[] = [];
  const channel = toOutreachChannel(opts.channel);
  // TM-1 · businesses skipped SPECIFICALLY because an email touch needs a
  // mailing address (CAN-SPAM/CASL) and the agency hasn't set one. Carried out
  // so the UI can say "set your mailing address in Settings" instead of a silent
  // "Drafted 0". Only the deterministic address gate counts here.
  let skippedNoAddress = 0;
  // A17 · businesses skipped because step 1 grounded ZERO pains (within the
  // allowed themes) — a zero-pain lead used to ship a 31-word generic note:
  // spam-shaped, and exactly where the CASL consent basis is weakest. NEW
  // generation gates them out; the regenerate path (actions.ts) intentionally
  // does NOT gate, so existing sparse drafts are never stranded.
  let skippedSparse = 0;
  const sequenceOf = Math.min(
    Math.max(1, Math.trunc(opts.sequenceLength ?? 1)),
    MAX_SEQUENCE_LENGTH,
  );

  for (const businessId of businessIds) {
    // Gather ONCE per business, then build every step from the same grounded
    // signals. Theme dedup (WP5-10): each step excludes the pain keys earlier
    // steps used, so a 3-touch sequence never repeats itself.
    let signals: TouchSignals;
    try {
      signals = await gatherTouchSignals(businessId);
    } catch {
      // Ungroundable prospect → skip (never ship a bad touch).
      continue;
    }

    const usedPainKeys: string[] = [];
    for (let step = 1; step <= sequenceOf; step += 1) {
      let touch: ReturnType<typeof buildChannelTouch>;
      try {
        // Channel-aware: email → full skeleton + CAN-SPAM footer; phone →
        // call script; social/dm → short DM.
        touch = buildChannelTouch(signals, {
          channel,
          sellingWhat: opts.sellingWhat,
          mailingAddress: opts.mailingAddress ?? null,
          unsubscribeUrl: opts.unsubscribeUrl ?? null,
          senderName: opts.senderName ?? null,
          tone: opts.tone,
          allowedPainKeys: opts.painPointKeys,
          excludePainKeys: usedPainKeys,
          sequenceStep: step,
          // WP6-15 · seed the per-agency pain-order rotation so two agencies
          // pitching the same lead don't send verbatim-identical openers.
          agencySeed: opts.agencyId,
          // A2/A14/A16 · per-business subject/frame variation so one batch
          // doesn't ship byte-identical subjects/openers/CTAs.
          variantSeed: businessId,
        });
      } catch {
        // Unbuildable (e.g. email with no CAN-SPAM address) → skip the whole
        // business; a partial sequence is worse than none. TM-1 · attribute the
        // deterministic address-gate skip so the UI can explain it (email + no
        // mailing address always throws in withCanSpamFooter at step 1).
        if (channel === "email" && !opts.mailingAddress) skippedNoAddress += 1;
        break;
      }

      // A17 · sparse gate: a step-1 touch grounded on ZERO pains is a generic
      // spam-shaped note — skip the business instead of persisting it. Only
      // gates NEW generation (see skippedSparse above).
      if (step === 1 && touch.usedSignals.length === 0) {
        skippedSparse += 1;
        break;
      }

      // WP7-4 / A12 · record the consent BASIS this email touch relies on,
      // BEFORE the draft write so the draft row can carry the ConsentRecord id
      // (audit trail). Cold outreach to a publicly-listed business email rests
      // on the CASL "conspicuous publication" exemption (s.10(9)(b)) / the
      // CAN-SPAM opt-out model — logged per (email, business) so the basis is
      // auditable. Email channel + known address only; best-effort (a consent
      // log failure must never block the draft — the draft just gets null).
      // Idempotent-ish: one row per generated step is fine (capturedAt tracks
      // recency).
      let consentRecordId: string | null = null;
      if (channel === "email" && signals.recipientEmail) {
        try {
          const consent = await prisma.consentRecord.create({
            data: {
              email: signals.recipientEmail.toLowerCase(),
              businessId,
              basis: "CONSPICUOUS_PUBLICATION",
              country: signals.country ?? "US",
              relevanceNote:
                `Publicly-listed ${signals.noun ?? "business"} contact; ` +
                `message relates to their online presence (${opts.sellingWhat}).`,
            },
            select: { id: true },
          });
          consentRecordId = consent.id;
        } catch {
          // Consent logging is best-effort — never block a generated draft.
        }
      }

      const draft = await prisma.outreachDraft.create({
        data: {
          businessId,
          agencyId: opts.agencyId,
          campaignId: opts.campaignId ?? null,
          // A12 · soft ref to the consent-basis row backing this email touch.
          consentRecordId,
          channel,
          subject: touch.subject ?? null,
          body: touch.body,
          whyJson: {
            why: touch.why,
            usedSignals: touch.usedSignals,
            droppedTokens: touch.droppedTokens,
            // WP5-10 · step encoded in whyJson (OutreachDraft has no ordinal
            // column; this avoids a schema change — see TouchpointsTab).
            sequenceStep: step,
            sequenceOf,
            tone: opts.tone ?? "direct",
            // Stored so regenerateTouchesAction can rebuild the opener
            // without re-asking what the agency sells.
            sellingWhat: opts.sellingWhat,
          },
          predictedTier: touch.predictedTier,
          status: "draft",
        },
        select: { id: true },
      });
      out.push({ businessId, draftId: draft.id });
      usedPainKeys.push(...touch.usedSignals);
    }
  }

  return { touches: out, skippedNoAddress, skippedSparse };
}
