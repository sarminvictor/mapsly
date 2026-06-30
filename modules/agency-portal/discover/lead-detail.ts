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

import {
  deriveMatchPct,
  painGroupClass,
  type LeadStatus,
  type PainGroup,
} from "./leads-workbench";
import { parseWhyJson } from "./touchpoints";

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
  facts: LeadFact[];
  phones: LeadContact[];
  emails: LeadContact[];
  socials: LeadContact[];
  /** Whether the contacts family is enriched (drives ghost contacts strip). */
  contactsEnriched: boolean;
  // ── 4. Why this lead qualifies ──
  firedSignals: LeadFiredSignal[];
  // ── 5. Other angles ──
  angles: LeadPainChip[];
  // ── 6. Data-domain accordions ──
  domains: LeadDomainBlock[];
  // ── 7. Expert findings ──
  expertFindings: LeadExpertFinding[];
  // ── 8. This lead's touches ──
  touches: LeadTouch[];
}

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load the full lead-detail payload for one business, scoped to `agencyId`.
 *
 * Returns null when the business doesn't exist OR doesn't live in any of the
 * calling agency's discovered cells (cross-agency / out-of-scope — we never
 * confirm another agency's data). Pure read; no external API.
 */
export async function getLeadDetail(
  businessId: string,
  agencyId: string,
): Promise<LeadDetail | null> {
  // The agency's discovered cells define its visible universe of businesses.
  const discoveries = await prisma.discovery.findMany({
    where: { agencyId },
    select: { cellKeys: true },
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
    },
  });

  // Agency-scope gate: missing or out-of-cell reads as null.
  if (!business || !business.cellKey || !cellKeys.includes(business.cellKey)) {
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
      select: { reviewCount: true, rating: true, reviewLifecycle: true },
    }),
    prisma.lighthouseAudit.findFirst({
      where: { businessId },
      orderBy: { auditedAt: "desc" },
      select: {
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
      where: { businessId },
      orderBy: [{ isPrimary: "desc" }, { confidence: "desc" }],
      select: { channel: true, value: true },
    }),
    prisma.outreachDraft.findMany({
      where: { businessId },
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
      },
      take: 25,
    }),
    prisma.serpResult.findFirst({
      where: { businessId },
      orderBy: { scannedAt: "desc" },
      select: { localPackRank: true, organicRank: true, kind: true },
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
  const { match, derived } = deriveMatchPct(null, pains.length);

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
              label: "Total / rating",
              value: `${(reviewCount ?? 0).toLocaleString()}${rating != null ? ` · ${rating.toFixed(1)}★` : ""}`,
            },
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
          ]
        : [],
      ghostNote:
        "Pull the latest reviews — rating, lifecycle, and unanswered negatives are pitch fuel.",
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
    facts,
    phones,
    emails,
    socials,
    contactsEnriched,
    firedSignals,
    angles,
    domains,
    expertFindings,
    touches,
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
