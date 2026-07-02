// modules/agency-portal/discover/lead-detail.ts · the SHARED, agency-scoped
// loader for the single-lead deep view. ONE loader, two consumers:
//   - the LeadDrawer (client, opened from the workbench via ?lead=<businessId>)
//   - the full-page business detail route (server)
// so the drawer and the page never diverge.
//
// `getLeadDetail(businessId, agencyId)` returns a PLAIN, fully serializable
// `LeadDetail` (no functions, no Date objects — ISO strings only) shaped to the
// prototype drawer's 9 sections (docs/portal-prototype.html fillDrawer):
//   1. header   · name / address / category / rating / reviews / open-status
//   2. pills    · reachable tier · match % · status · compliance · closed
//   3. atGlance · match gauge + fact grid + contacts strip
//   4. why      · fired composite signals (flagged findings) w/ evidence + pitch
//   5. angles   · other pain-point chips
//   6. domains  · Reviews / Website&tech / Site speed / Ads / Search / Services /
//                 AI research — each REAL when enriched, else a ghost "enrich to
//                 unlock" card (the `enriched` flag drives the fallback)
//   7. findings · compliance / accessibility expert warnings + evidence
//   8. touches  · this lead's OutreachDraft sequence
//   9. footer   · the action surface (rendered client-side)
//
// AGENCY-SCOPED: a business is only returned when it lives in one of the calling
// agency's discovered cells. Cross-agency / missing → null. No external API in
// the request path — every field reads an already-enriched DB row
// (`.claude/rules/security.md`, `.claude/rules/cost-discipline.md`).

import prisma from "@/lib/prisma";
import { draftWhereForAgency } from "@/modules/outreach/draft-scope";

import {
  deriveMatchPct,
  painGroupClass,
  type LeadStatus,
  type PainGroup,
} from "./leads-workbench";
import { parseWhyJson } from "./touchpoints";
import {
  hydrateBusinessForSignals,
  resolveMatches,
  type ActiveSignal,
} from "./signal-eval";
import { activeSignalsFromJson } from "./discovery-signals";
import { SIG_META } from "./goal-templates";
import type { BandKey } from "./signals";

// ── Serializable sub-shapes ──────────────────────────────────────────────────

/** A key/value fact for the "At a glance" fact grid. */
export interface LeadFact {
  key: string;
  value: string;
}

/** One contact channel value rendered in the contacts strip. */
export interface LeadContact {
  /** Display value (phone number, email, or social handle/url). */
  value: string;
  /** href scheme/url: `tel:…` / `mailto:…` / a social URL. */
  href: string;
}

/** One evidence row under a fired composite (a labelled metric line). */
export interface LeadEvidenceRow {
  label: string;
  /** Plain-text value (e.g. "38/100 · cell median 58"). No HTML. */
  value: string;
  /** Optional tone for the value text (g/a/r → green/amber/red). */
  tone?: "g" | "a" | "r" | null;
  /**
   * WP5-11/WP6-1 · optional STRUCTURED metric behind the text value. When
   * present AND the workbench has a vs-cell band for `bandKey`, the drawer
   * renders a VsCellBar (the value on the cell distribution) instead of the
   * plain text — the text form stays the graceful fallback. `bandKey` matches
   * the workbench's band keys (reviews / rating / perf / organic / ads /
   * tenure / match). WP6-1 added rating / organic / ads / tenure so the drawer
   * shows 4–6 market-relative bars, not just reviews.
   */
  metric?: {
    value: number;
    bandKey: BandKey;
    unit?: string;
  } | null;
}

/** A fired composite signal (a flagged PlaybookFinding) w/ evidence + pitch. */
export interface LeadFiredSignal {
  /** Stable signal key (PlaybookFinding.signalKey). */
  key: string;
  /** Human title for the composite. */
  title: string;
  /** Confidence: high / medium / low. */
  confidence: string;
  /** One-line "what this means" summary (the explanation). */
  summary: string | null;
  /** The pitch angle (closing weapon). */
  pitch: string | null;
  /** Signal group → ppchip color modifier. */
  group: PainGroup;
  /** Raw evidence rows backing the composite. */
  evidence: LeadEvidenceRow[];
}

/** A pain-point chip (an "other angle to pitch"). */
export interface LeadPainChip {
  group: PainGroup;
  label: string;
  title: string;
}

/**
 * One of the RESEARCH's signals evaluated against this lead (P3). Unlike
 * {@link LeadFiredSignal} (a flagged playbook composite with evidence), this is
 * the honest per-lead verdict for each signal the goal actually chose:
 *   - matched=true  · the signal fired for this lead (a real qualifier)
 *   - matched=false · evaluated, did not fire
 *   - matched=null  · NOT computable yet (the backing data isn't enriched) —
 *     shown as "enrich to unlock", never a fake match.
 */
export interface LeadSignalVerdict {
  /** SIG_META key. */
  key: string;
  /** Human title (SIG_META.title). */
  title: string;
  /** Plain-English "what it means" (SIG_META.means). */
  means: string;
  /** true = fired · false = didn't · null = not computable (enrich to unlock). */
  matched: boolean | null;
}

/**
 * One data-domain accordion block. `enriched=false` → the drawer renders the
 * ghost "not enriched yet — enrich to unlock" card; otherwise the real
 * `summary` + `rows` are shown.
 */
export interface LeadDomainBlock {
  /** Stable key (reviews / tech / speed / ads / serp / services / ai). */
  key: string;
  /** Emoji icon (prototype parity). */
  icon: string;
  /** Section title. */
  title: string;
  /** Whether the backing family is enriched (drives ghost fallback). */
  enriched: boolean;
  /** Collapsed-state one-line summary (only when enriched). */
  summary: string | null;
  /** Detail rows shown on expand (only when enriched). */
  rows: LeadEvidenceRow[];
  /** Ghost-card note shown when not enriched. */
  ghostNote: string;
  /**
   * WP6-9 · evidence-honesty provenance. `source` names where the data came
   * from ("Google reviews", "Lighthouse mobile", "Meta Ad Library", …) and
   * `asOf` is the ISO date it was retrieved (from auditedAt / snapshotDate /
   * lastSeenAt). The drawer renders "{source} · as of {date}" so every block is
   * auditable. Null when the block isn't enriched (nothing to attribute).
   */
  source: string | null;
  asOf: string | null;
}

/** An expert finding callout (compliance / accessibility risk). */
export interface LeadExpertFinding {
  /** Stable key. */
  key: string;
  /** Tone of the callout (amber/red). */
  tone: "amber" | "red";
  /** Bold lead-in. */
  title: string;
  /** Body text. */
  body: string;
}

/** One touch (OutreachDraft) in this lead's sequence. */
export interface LeadTouch {
  draftId: string;
  /** 1-based step number. */
  seq: number;
  /** Total steps in the sequence. */
  of: number;
  channel: string;
  subject: string | null;
  body: string;
  /** "Draft" | "Sent" (rendered as a status pill). */
  status: "Draft" | "Sent";
  /** Why-strings backing this touch (neutral chips). */
  why: string[];
}

/** The full, serializable lead-detail payload the drawer renders. */
export interface LeadDetail {
  businessId: string;
  /** Real Lead id when the business already lives in a saved list (wired status). */
  leadId: string | null;
  // ── 1. Header ──
  name: string;
  /** "1200 Brickell Ave, Miami FL" (assembled). */
  addressLine: string;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** Human open-status ("Open now" / "Temporarily closed" / "—"). */
  openStatus: string;
  /** True when the business is temporarily/permanently closed. */
  closed: boolean;
  website: string | null;
  // ── 2. Pills ──
  /** Reachability tier (RICH / MULTI / PHONE_ONLY / …). */
  reachability: string;
  /** Lead status (drives the status pill). */
  status: LeadStatus;
  /** Whether a compliance flag fired (ads + no pixel proxy / HIPAA finding). */
  complianceFlag: boolean;
  // ── 3. At a glance ──
  /** 0–100 match %. */
  match: number;
  /** True when match was derived (not a stored score). */
  matchDerived: boolean;
  /**
   * True when `match` came from evaluating the research's signals against this
   * lead (resolveMatches over the discovery's signalsJson) rather than the
   * pain-count heuristic. Drives the gauge's "real match" framing.
   */
  matchFromSignals: boolean;
  facts: LeadFact[];
  phones: LeadContact[];
  emails: LeadContact[];
  socials: LeadContact[];
  /** Whether the contacts family is enriched (drives ghost contacts strip). */
  contactsEnriched: boolean;
  // ── 4. Why this lead qualifies ──
  firedSignals: LeadFiredSignal[];
  /**
   * The research's chosen signals, each with its honest per-lead verdict (P3).
   * Empty when the lead wasn't opened from a discovery with persisted signals
   * (the drawer then falls back to the finding-based `firedSignals` only).
   */
  signalVerdicts: LeadSignalVerdict[];
  // ── 5. Other angles ──
  angles: LeadPainChip[];
  // ── 6. Data-domain accordions ──
  domains: LeadDomainBlock[];
  // ── 7. Expert findings ──
  expertFindings: LeadExpertFinding[];
  // ── 8. This lead's touches ──
  touches: LeadTouch[];
  /**
   * WP6-9 · evidence-honesty note. Non-null when generating this lead's touches
   * pruned one or more claims we couldn't verify (whyJson.droppedTokens) — the
   * drawer surfaces "We only cite what we verified — N claim(s) we couldn't
   * confirm were left out." Null when nothing was dropped (no note shown).
   */
  verifiedNote: string | null;
}

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load the full lead-detail payload for one business, scoped to `agencyId`.
 *
 * Returns null when the business doesn't exist OR doesn't live in any of the
 * calling agency's discovered cells (cross-agency / out-of-scope — we never
 * confirm another agency's data). Pure read; no external API.
 *
 * When `discoveryId` is given and that discovery has persisted signals
 * (signalsJson), the drawer's "why this lead qualifies" surfaces the honest
 * per-lead verdict for each chosen signal, and the match gauge reflects the REAL
 * resolveMatches % (P3). Without it (or for an older discovery with no signals),
 * the loader falls back to the pain-count heuristic + finding-based composites.
 */
export async function getLeadDetail(
  businessId: string,
  agencyId: string,
  discoveryId?: string,
): Promise<LeadDetail | null> {
  // The agency's discovered cells define its visible universe of businesses.
  // Pull each discovery's id + signalsJson too so we can evaluate the lead
  // against the research's signals (preferring the discovery the drawer was
  // opened from, falling back to any agency discovery whose cell holds it).
  const discoveries = await prisma.discovery.findMany({
    where: { agencyId },
    select: { id: true, cellKeys: true, signalsJson: true },
  });
  const cellKeys = Array.from(new Set(discoveries.flatMap((d) => d.cellKeys)));
  if (cellKeys.length === 0) return null;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      category: true,
      address: true,
      city: true,
      province: true,
      country: true,
      rating: true,
      reviewCount: true,
      website: true,
      phone: true,
      email: true,
      photosCount: true,
      isClaimed: true,
      firstSeenOnGoogle: true,
      openStatus: true,
      reachability: true,
      reachableChannelCount: true,
      cellKey: true,
      suppressedAt: true,
    },
  });

  // Agency-scope gate: missing or out-of-cell reads as null.
  // WP7-2 · a do-not-sell-suppressed business reads as null too — its drawer,
  // one-pager, and public share page all resolve through getLeadDetail, so this
  // one gate removes the suppressed business from every rendered artifact.
  if (
    !business ||
    business.suppressedAt !== null ||
    !business.cellKey ||
    !cellKeys.includes(business.cellKey)
  ) {
    return null;
  }

  // All per-business side loads in parallel (each is a bounded, agency-safe read
  // — the business already passed the cell gate above).
  const [
    lead,
    snapshot,
    audit,
    findings,
    techs,
    contacts,
    drafts,
    negUnanswered,
    ads,
    serp,
    services,
    research,
  ] = await Promise.all([
    // The business already passed the agency cell gate above; scoping the Lead
    // to the same agencyId is enough (a Lead is owned by exactly one agency).
    prisma.lead.findFirst({
      where: { agencyId, businessId },
      orderBy: { statusChangedAt: "desc" },
      select: { id: true, status: true },
    }),
    prisma.businessSnapshot.findFirst({
      where: { businessId },
      orderBy: { snapshotDate: "desc" },
      // WP6-9 · snapshotDate is the "as of" provenance for the Reviews block.
      select: {
        reviewCount: true,
        rating: true,
        reviewLifecycle: true,
        snapshotDate: true,
      },
    }),
    prisma.lighthouseAudit.findFirst({
      where: { businessId },
      orderBy: { auditedAt: "desc" },
      select: {
        // WP6-9 · auditedAt is the "as of" provenance for the Site-speed block.
        auditedAt: true,
        performance: true,
        accessibility: true,
        seo: true,
        lcp: true,
        cls: true,
        inp: true,
        perfSavingsMs: true,
        a11yViolationCount: true,
        a11yCriticalCount: true,
        isOnHttps: true,
        formFactor: true,
      },
    }),
    prisma.playbookFinding.findMany({
      where: { businessId, status: "flagged" },
      orderBy: { confidence: "asc" },
      select: {
        signalKey: true,
        group: true,
        confidence: true,
        explanation: true,
        pitchAngle: true,
      },
      take: 50,
    }),
    prisma.businessTech.findMany({
      where: { businessId },
      orderBy: { confidence: "desc" },
      select: { name: true, category: true },
    }),
    prisma.contact.findMany({
      // WP7-2 · opted-out contacts never render in the drawer or the one-pager
      // (getLeadDetail feeds both the drawer and the Proof Pack / share page).
      where: { businessId, optedOutAt: null },
      orderBy: [{ isPrimary: "desc" }, { confidence: "desc" }],
      select: { channel: true, value: true },
    }),
    prisma.outreachDraft.findMany({
      // WP5 draft security: this agency's drafts only (legacy null rows ride
      // the OR-null arm — the business already passed the cell gate above).
      where: draftWhereForAgency(agencyId, [businessId]),
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        channel: true,
        subject: true,
        body: true,
        status: true,
        whyJson: true,
      },
    }),
    prisma.review.count({
      where: { businessId, ownerReplied: false, stars: { lte: 2 } },
    }),
    prisma.adLibraryEntry.findMany({
      where: { businessId },
      orderBy: { lastSeenAt: "desc" },
      select: {
        platform: true,
        isActive: true,
        displayFormat: true,
        spendBandUsd: true,
        advertiserName: true,
        // WP6-9 · lastSeenAt provenance for the Ads block.
        lastSeenAt: true,
      },
      take: 25,
    }),
    prisma.serpResult.findFirst({
      where: { businessId },
      orderBy: { scannedAt: "desc" },
      // WP6-9 · scannedAt provenance for the Search block.
      select: {
        localPackRank: true,
        organicRank: true,
        kind: true,
        scannedAt: true,
      },
    }),
    prisma.businessService.findMany({
      where: { businessId, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { name: true, category: true },
      take: 20,
    }),
    prisma.businessEnrichment.findUnique({
      where: { businessId },
      select: {
        subType: true,
        sophistication: true,
        pricingTransparency: true,
        positioningSummary: true,
        painHypotheses: true,
        competitivePositioning: true,
        complianceCues: true,
      },
    }),
  ]);

  // ── Contacts → phones / emails / socials ──
  const phones: LeadContact[] = [];
  const emails: LeadContact[] = [];
  const socials: LeadContact[] = [];
  const seenContact = new Set<string>();
  for (const c of contacts) {
    const dedupeKey = `${c.channel}:${c.value}`;
    if (seenContact.has(dedupeKey)) continue;
    seenContact.add(dedupeKey);
    if (c.channel === "PHONE" || c.channel === "WHATSAPP") {
      phones.push({ value: c.value, href: `tel:${c.value}` });
    } else if (c.channel === "EMAIL") {
      emails.push({ value: c.value, href: `mailto:${c.value}` });
    } else if (
      c.channel === "FACEBOOK" ||
      c.channel === "INSTAGRAM" ||
      c.channel === "LINKEDIN" ||
      c.channel === "TIKTOK" ||
      c.channel === "YOUTUBE" ||
      c.channel === "X" ||
      c.channel === "YELP"
    ) {
      socials.push({ value: socialLabel(c.channel), href: c.value });
    }
  }
  // Fall back to the Business scalars when no Contact rows exist.
  if (phones.length === 0 && business.phone) {
    phones.push({ value: business.phone, href: `tel:${business.phone}` });
  }
  if (emails.length === 0 && business.email) {
    emails.push({ value: business.email, href: `mailto:${business.email}` });
  }
  const contactsEnriched =
    contacts.length > 0 || phones.length > 0 || emails.length > 0;

  // ── CMS built-on + tech presence (for the Website & tech accordion) ──
  const cms = techs.find((t) => t.category === "CMS")?.name ?? null;
  const hasPixel = techs.some((t) => t.category === "PIXEL");
  const hasAnalytics = techs.some((t) => t.category === "ANALYTICS");
  const hasBooking = techs.some((t) => t.category === "BOOKING");
  const hasChat = techs.some((t) => t.category === "CHAT");
  const techScanned = techs.length > 0;

  // ── Reviews / rating / perf (latest snapshot wins, else Business scalar) ──
  const reviewCount = snapshot?.reviewCount ?? business.reviewCount ?? null;
  const rating = snapshot?.rating ?? business.rating ?? null;
  const perf = audit?.performance ?? null;

  // ── Ads ──
  const runsAds = ads.some((a) => a.isActive);
  const metaAds = ads.filter((a) => a.platform === "META");
  const googleAds = ads.filter((a) => a.platform === "GOOGLE");

  // ── Pains (flagged findings) ──
  const pains: LeadPainChip[] = findings.map((f) => ({
    group: painGroupClass(f.group),
    label: signalKeyLabel(f.signalKey),
    title: f.explanation || f.pitchAngle || signalKeyLabel(f.signalKey),
  }));

  // ── The research's signals → honest per-lead verdicts + REAL match% (P3) ──
  // Prefer the discovery the drawer was opened from; else the first agency
  // discovery (whose cell holds this business) that has persisted signals.
  const sourceDiscovery =
    (discoveryId ? discoveries.find((d) => d.id === discoveryId) : undefined) ??
    discoveries.find(
      (d) =>
        business.cellKey != null &&
        d.cellKeys.includes(business.cellKey) &&
        activeSignalsFromJson(d.signalsJson).length > 0,
    );
  const activeSignals: ActiveSignal[] = sourceDiscovery
    ? activeSignalsFromJson(sourceDiscovery.signalsJson)
    : [];

  let signalVerdicts: LeadSignalVerdict[] = [];
  let matchFromSignals = false;
  let match: number;
  let derived: boolean;

  if (activeSignals.length > 0) {
    // Evaluate the real signals against THIS lead's stored data (one hydrate).
    const hydrated = (await hydrateBusinessForSignals([businessId])).get(
      businessId,
    );
    if (hydrated) {
      const result = resolveMatches(activeSignals, hydrated);
      signalVerdicts = activeSignals.map((sig) => {
        const meta = SIG_META[sig.key];
        return {
          key: sig.key,
          title: meta?.title ?? signalKeyLabel(sig.key),
          means: meta?.means ?? "",
          matched: result.perSignal[sig.key] ?? null,
        };
      });
      // A null-only cohort (nothing computable yet) → no honest %; fall back to
      // the heuristic so the gauge isn't a misleading 0.
      if (result.applicableCount > 0) {
        match = Math.round(result.matchPct * 100);
        derived = false;
        matchFromSignals = true;
      } else {
        ({ match, derived } = deriveMatchPct(null, pains.length));
      }
    } else {
      ({ match, derived } = deriveMatchPct(null, pains.length));
    }
  } else {
    // No persisted signals (older discovery / none active) → heuristic fallback.
    ({ match, derived } = deriveMatchPct(null, pains.length));
  }

  // ── Compliance flag: a flagged HIPAA finding OR (runs ads + no pixel) ──
  const hipaaFinding = findings.some(
    (f) => f.signalKey === "hipaa-pixel-on-phi-page",
  );
  const complianceFlag = hipaaFinding || (runsAds && techScanned && !hasPixel);

  // ── Fired composite signals (flagged findings → cards w/ evidence) ──
  const firedSignals: LeadFiredSignal[] = findings.map((f) => ({
    key: f.signalKey,
    title: signalKeyLabel(f.signalKey),
    confidence: f.confidence,
    summary: f.explanation || null,
    pitch: f.pitchAngle || null,
    group: painGroupClass(f.group),
    evidence: [],
  }));

  // ── "Other angles": pains not already surfaced as fired composites ──
  const firedKeys = new Set(firedSignals.map((s) => s.key));
  const firedLabels = new Set(firedSignals.map((s) => s.title));
  const angles: LeadPainChip[] = pains.filter(
    (p) => !firedKeys.has(p.label) && !firedLabels.has(p.label),
  );

  // ── Open-status + closed flag ──
  const openStatus = openStatusLabel(business.openStatus);
  const closed =
    business.openStatus === "CLOSED" ||
    business.openStatus === "TEMPORARILY_CLOSED" ||
    business.openStatus === "CLOSED_FOREVER";

  // ── Years on Google (proxy for site age) ──
  const yearsOnGoogle = business.firstSeenOnGoogle
    ? Math.max(0, yearsSince(business.firstSeenOnGoogle))
    : null;

  // ── "At a glance" fact grid ──
  const facts: LeadFact[] = [
    { key: "Category", value: business.category ?? "—" },
    { key: "City", value: business.city ?? "—" },
    {
      key: "Photos",
      value:
        business.photosCount != null
          ? business.photosCount.toLocaleString()
          : "—",
    },
    { key: "Claimed", value: business.isClaimed ? "Yes" : "No" },
    { key: "Built on", value: cms ?? "—" },
    {
      key: "Years on Google",
      value: yearsOnGoogle != null ? `~${yearsOnGoogle} yrs` : "—",
    },
  ];

  // ── Data-domain accordions ──
  const reviewsEnriched = reviewCount != null;
  const techEnriched = techScanned || cms != null;
  const speedEnriched = audit != null;
  const adsEnriched = ads.length > 0;
  const serpEnriched = serp != null;
  const servicesEnriched = services.length > 0;
  const aiEnriched = research != null;

  // WP6-9 · per-block provenance — the retrieval date backing each domain, so
  // every evidence block reads "{source} · as of {date}". Nulls degrade to the
  // source line alone (or nothing when not enriched).
  const adsLastSeen = ads
    .map((a) => a.lastSeenAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const domains: LeadDomainBlock[] = [
    {
      key: "reviews",
      icon: "⭐",
      title: "Reviews",
      enriched: reviewsEnriched,
      summary: reviewsEnriched
        ? `${(reviewCount ?? 0).toLocaleString()} · ${rating != null ? `${rating.toFixed(1)}★` : "—"}${
            snapshot?.reviewLifecycle
              ? ` · ${lifecycleLabel(snapshot.reviewLifecycle)}`
              : ""
          }`
        : null,
      rows: reviewsEnriched
        ? [
            {
              label: "Total reviews",
              value: (reviewCount ?? 0).toLocaleString(),
              // WP5-11 · structured review count → vs-cell bar when the
              // workbench has a "reviews" band (text stays the fallback).
              metric:
                reviewCount != null
                  ? { value: reviewCount, bandKey: "reviews" as const }
                  : null,
            },
            // WP6-1 · rating as its own market-relative bar (rating band).
            ...(rating != null
              ? [
                  {
                    label: "Rating",
                    value: `${rating.toFixed(1)}★`,
                    metric: {
                      value: rating,
                      bandKey: "rating" as const,
                      unit: "★",
                    },
                  },
                ]
              : []),
            ...(snapshot?.reviewLifecycle
              ? [
                  {
                    label: "Lifecycle (90d)",
                    value: lifecycleLabel(snapshot.reviewLifecycle),
                  },
                ]
              : []),
            {
              label: "Unanswered ≤2★",
              value: negUnanswered.toLocaleString(),
              tone: negUnanswered > 0 ? ("r" as const) : null,
            },
            // WP6-1 · years-on-Google (tenure) as a market-relative bar — how
            // established this lead is vs the cell. Cohort-sourced (CellMetric
            // has no tenure percentile), so the bar shows only when enough
            // cohort tenure samples exist; text stays the fallback.
            ...(yearsOnGoogle != null
              ? [
                  {
                    label: "Years on Google",
                    value: `~${yearsOnGoogle} yr${yearsOnGoogle === 1 ? "" : "s"}`,
                    metric: {
                      value: yearsOnGoogle,
                      bandKey: "tenure" as const,
                      unit: " yrs",
                    },
                  },
                ]
              : []),
          ]
        : [],
      ghostNote:
        "Pull the latest reviews — rating, lifecycle, and unanswered negatives are pitch fuel.",
      source: reviewsEnriched ? "Google reviews" : null,
      asOf: reviewsEnriched ? isoDay(snapshot?.snapshotDate) : null,
    },
    {
      key: "tech",
      icon: "🖥️",
      title: "Website & tech",
      enriched: techEnriched,
      summary: techEnriched
        ? `${cms ?? "Custom"}${!hasPixel ? " · no pixel" : ""} · booking ${hasBooking ? "online" : "phone"}`
        : null,
      rows: techEnriched
        ? [
            { label: "Built on", value: cms ?? "Custom / unknown" },
            {
              label: "Tracking pixel",
              value: hasPixel ? "Present" : "Not detected",
              tone: hasPixel ? null : ("a" as const),
            },
            {
              label: "Analytics",
              value: hasAnalytics ? "Present" : "Not detected",
              tone: hasAnalytics ? null : ("a" as const),
            },
            {
              label: "Live chat",
              value: hasChat ? "Present" : "None",
            },
            {
              label: "Online booking",
              value: hasBooking ? "Online" : "Phone only",
              tone: hasBooking ? null : ("a" as const),
            },
          ]
        : [],
      ghostNote:
        "Scan the site's tech stack — CMS, pixel, analytics, and booking gaps open the pitch.",
      source: techEnriched ? "Website scan" : null,
      asOf: null,
    },
    {
      key: "speed",
      icon: "⚡",
      title: "Site speed",
      enriched: speedEnriched,
      summary: speedEnriched
        ? `${perf != null ? `${Math.round(perf)}/100` : "—"} · CWV ${perf != null && perf < 50 ? "failing" : "ok"}`
        : null,
      rows: speedEnriched
        ? [
            {
              label: `Performance (${audit?.formFactor ?? "mobile"})`,
              value: perf != null ? `${Math.round(perf)}/100` : "—",
              tone: perf != null ? perfTone(perf) : null,
              // WP5-11 · structured Lighthouse score → vs-cell bar when the
              // workbench has a "perf" band (text stays the fallback).
              metric:
                perf != null
                  ? {
                      value: Math.round(perf),
                      bandKey: "perf" as const,
                      unit: "/100",
                    }
                  : null,
            },
            ...(audit?.lcp != null
              ? [
                  {
                    label: "LCP",
                    value: `${audit.lcp.toFixed(1)}s`,
                    tone: audit.lcp > 2.5 ? ("r" as const) : null,
                  },
                ]
              : []),
            ...(audit?.cls != null
              ? [{ label: "CLS", value: audit.cls.toFixed(2) }]
              : []),
            ...(audit?.accessibility != null
              ? [
                  {
                    label: "Accessibility",
                    value: `${Math.round(audit.accessibility)}/100`,
                    tone: audit.accessibility < 70 ? ("a" as const) : null,
                  },
                ]
              : []),
            ...(audit?.perfSavingsMs != null
              ? [
                  {
                    label: "Potential savings",
                    value: `~${(audit.perfSavingsMs / 1000).toFixed(1)}s faster`,
                  },
                ]
              : []),
          ]
        : [],
      ghostNote:
        "Run a mobile Lighthouse audit — slow sites lose high-intent clicks before the page loads.",
      source: speedEnriched ? "Lighthouse mobile" : null,
      asOf: speedEnriched ? isoDay(audit?.auditedAt) : null,
    },
    {
      key: "ads",
      icon: "📣",
      title: "Ads",
      enriched: adsEnriched,
      summary: adsEnriched
        ? `Meta: ${metaAds.length ? (runsAds ? "running" : "paused") : "—"}${googleAds.length ? ` · Google: ${googleAds.length}` : ""}`
        : null,
      rows: adsEnriched
        ? [
            {
              label: "Meta ads",
              value: metaAds.length
                ? `${metaAds.length} creative${metaAds.length === 1 ? "" : "s"}${runsAds ? " · running" : ""}`
                : "—",
              tone: runsAds ? ("g" as const) : null,
              // WP6-1 · Meta-ad count as a market-relative bar (ads band) — how
              // this lead's ad presence compares to the cell. Text stays the
              // fallback when no ads band exists.
              metric: { value: metaAds.length, bandKey: "ads" as const },
            },
            ...(metaAds.length
              ? [
                  {
                    label: "Formats",
                    value:
                      Array.from(
                        new Set(
                          metaAds
                            .map((a) => a.displayFormat)
                            .filter((v): v is string => !!v),
                        ),
                      ).join(" · ") || "—",
                  },
                ]
              : []),
            ...(googleAds.length
              ? [{ label: "Google ads", value: `${googleAds.length} active` }]
              : []),
          ]
        : [],
      ghostNote:
        "Discovery flagged ad activity — enrich the Meta Ad Library scan for creatives & spend.",
      source: adsEnriched ? "Meta Ad Library" : null,
      asOf: adsEnriched ? isoDay(adsLastSeen) : null,
    },
    {
      key: "serp",
      icon: "🔍",
      title: "Search / SERP",
      enriched: serpEnriched,
      summary: serpEnriched
        ? `${serp?.localPackRank != null ? `#${serp.localPackRank} 3-pack` : "off the pack"}${
            serp?.organicRank != null ? ` · organic #${serp.organicRank}` : ""
          }`
        : null,
      rows: serpEnriched
        ? [
            {
              label: "Local 3-pack rank",
              value:
                serp?.localPackRank != null
                  ? `#${serp.localPackRank} · in the pack`
                  : "Off the pack",
              tone:
                serp?.localPackRank != null ? ("g" as const) : ("a" as const),
            },
            ...(serp?.organicRank != null
              ? [{ label: "Organic rank", value: `#${serp.organicRank}` }]
              : []),
          ]
        : [],
      ghostNote:
        "Scan the local 3-pack + organic ranks — visibility gaps are an easy first pitch.",
      source: serpEnriched ? "Google Search" : null,
      asOf: serpEnriched ? isoDay(serp?.scannedAt) : null,
    },
    {
      key: "services",
      icon: "🧾",
      title: "Services",
      enriched: servicesEnriched,
      summary: servicesEnriched
        ? services
            .slice(0, 3)
            .map((s) => s.name)
            .join(" · ") +
          (services.length > 3 ? ` · +${services.length - 3}` : "")
        : null,
      rows: servicesEnriched
        ? services.map((s) => ({
            label: s.name,
            value: s.category ?? "—",
          }))
        : [],
      ghostNote:
        "Detect the service menu — service gaps vs the cell are a differentiator pitch.",
      source: servicesEnriched ? "Website menu" : null,
      asOf: null,
    },
    {
      key: "ai",
      icon: "🧠",
      title: "AI research",
      enriched: aiEnriched,
      summary: aiEnriched
        ? [research?.subType, research?.sophistication]
            .filter(Boolean)
            .join(" · ") || "Positioning · pricing · pain hypotheses"
        : null,
      rows: aiEnriched
        ? [
            ...(research?.subType
              ? [{ label: "Sub-type", value: research.subType }]
              : []),
            ...(research?.sophistication
              ? [{ label: "Sophistication", value: research.sophistication }]
              : []),
            ...(research?.pricingTransparency
              ? [
                  {
                    label: "Pricing transparency",
                    value: research.pricingTransparency,
                    tone:
                      research.pricingTransparency.toLowerCase() === "opaque"
                        ? ("a" as const)
                        : null,
                  },
                ]
              : []),
            ...(research?.positioningSummary
              ? [{ label: "Positioning", value: research.positioningSummary }]
              : []),
            ...(research?.competitivePositioning
              ? [
                  {
                    label: "Vs cell leader",
                    value: research.competitivePositioning,
                  },
                ]
              : []),
            ...(research?.painHypotheses ?? []).map((p, i) => ({
              label: `Pain hypothesis ${i + 1}`,
              value: p,
            })),
          ]
        : [],
      ghostNote:
        "Positioning, pricing transparency, pain hypotheses — an AI read on how to pitch this business.",
      source: aiEnriched ? "AI analysis of public sources" : null,
      asOf: null,
    },
  ];

  // ── Expert findings (compliance + accessibility callouts) ──
  const expertFindings: LeadExpertFinding[] = [];
  if (complianceFlag) {
    expertFindings.push({
      key: "compliance-pixel",
      tone: "amber",
      title: "Legal & compliance risk (worth checking)",
      body: "Tracking pixel on a page that takes bookings while ads run — spend can't be attributed, and for health businesses it's a real exposure talking point. Exposure-framed, not an accusation.",
    });
  }
  if (
    audit?.a11yCriticalCount != null
      ? audit.a11yCriticalCount > 0
      : audit?.accessibility != null && audit.accessibility < 70
  ) {
    expertFindings.push({
      key: "a11y-risk",
      tone: "amber",
      title: "ADA / accessibility risk",
      body: `${
        audit?.a11yViolationCount != null
          ? `${audit.a11yViolationCount} Lighthouse accessibility failure${audit.a11yViolationCount === 1 ? "" : "s"}`
          : "Multiple serious Lighthouse accessibility failures"
      } — a real exposure talking point for service businesses.`,
    });
  }

  // ── Touches (this lead's OutreachDraft sequence) ──
  const touches: LeadTouch[] = drafts.map((d, i) => {
    const { why } = parseWhyJson(d.whyJson);
    return {
      draftId: d.id,
      seq: i + 1,
      of: drafts.length,
      channel: d.channel,
      subject: d.subject,
      body: d.body,
      status: d.status === "sent" ? "Sent" : "Draft",
      why,
    };
  });

  // ── WP6-9 · "we only cite what we verified" note ──
  // Touch generation records the claims it PRUNED because the backing data
  // wasn't verified (whyJson.droppedTokens). If any draft dropped a claim,
  // surface an honest note — the auditable-evidence trust feature. Counts the
  // distinct dropped claims across this lead's drafts.
  const dropped = new Set<string>();
  for (const d of drafts) {
    for (const tok of droppedTokensFrom(d.whyJson)) dropped.add(tok);
  }
  const verifiedNote =
    dropped.size > 0
      ? `We only cite what we verified — ${dropped.size} claim${dropped.size === 1 ? "" : "s"} we couldn't confirm ${dropped.size === 1 ? "was" : "were"} left out.`
      : null;

  const addressLine =
    [business.address, business.city, business.province, business.country]
      .filter(Boolean)
      .join(", ") || "—";

  return {
    businessId: business.id,
    leadId: lead?.id ?? null,
    name: business.name,
    addressLine,
    category: business.category ?? null,
    rating,
    reviewCount,
    openStatus,
    closed,
    website: business.website ?? null,
    reachability: business.reachability,
    status: (lead?.status ?? "NEW") as LeadStatus,
    complianceFlag,
    match,
    matchDerived: derived,
    matchFromSignals,
    facts,
    phones,
    emails,
    socials,
    contactsEnriched,
    firedSignals,
    signalVerdicts,
    angles,
    domains,
    expertFindings,
    touches,
    verifiedNote,
  };
}

// ── Pure label/format helpers ────────────────────────────────────────────────

/** "perf_savings_ms" / "hipaa-pixel-on-phi-page" → "Perf savings ms". */
function signalKeyLabel(key: string): string {
  const words = key.replace(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Human label for a BusinessOpenStatus enum value. */
function openStatusLabel(status: string): string {
  switch (status) {
    case "OPEN":
      return "Open now";
    case "CLOSED":
      return "Closed";
    case "TEMPORARILY_CLOSED":
      return "Temporarily closed";
    case "CLOSED_FOREVER":
      return "Permanently closed";
    default:
      return "—";
  }
}

/** Review lifecycle enum → human label. */
function lifecycleLabel(raw: string): string {
  switch (raw) {
    case "TRENDING":
      return "Trending ↑";
    case "STABLE":
      return "Steady";
    case "DYING":
      return "Slowing ↓";
    case "DORMANT":
      return "Dormant";
    default:
      return raw;
  }
}

/** Tone for a Lighthouse perf score (higher is better). */
function perfTone(perf: number): "g" | "a" | "r" {
  if (perf >= 65) return "g";
  if (perf >= 45) return "a";
  return "r";
}

/** Social-channel display label ("Instagram", "Facebook", …). The href carries
 *  the full URL; the chip shows the platform name. */
function socialLabel(channel: string): string {
  return channel.charAt(0) + channel.slice(1).toLowerCase();
}

/** Whole years since a date (floor). */
function yearsSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));
}

/** WP6-9 · ISO day (YYYY-MM-DD) for a nullable date — the "as of" provenance
 *  stamp. Null-safe: returns null so the drawer renders the source line alone. */
function isoDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** WP6-9 · pull `droppedTokens` (claims pruned as unverified) from an opaque
 *  whyJson blob. Pure + defensive: any non-array/non-string is ignored. */
function droppedTokensFrom(whyJson: unknown): string[] {
  if (whyJson === null || typeof whyJson !== "object") return [];
  const raw = (whyJson as Record<string, unknown>).droppedTokens;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
}
