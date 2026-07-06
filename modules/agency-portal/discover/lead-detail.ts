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
//                 AI research — each rendered off its honest run STATE (from the
//                 SHARED loadTypeStatesForBusinesses loader): enriched / empty /
//                 failed / running / not_run
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
import {
  dataGroupFor,
  rollUpGroupState,
  typeKeyForEnrichToken,
  type TypeState,
} from "./family-coverage";
import { loadTypeStatesForBusinesses } from "./coverage-matrix";
import { researchesForSignals } from "./researches";
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
  /**
   * E6 · the source ContactChannel for a SOCIAL row (INSTAGRAM / FACEBOOK /
   * TIKTOK / YOUTUBE / X / LINKEDIN / YELP) so the drawer's socials strip can
   * pick a per-platform icon. Absent on phone/email rows.
   */
  channel?: string;
  /**
   * Issue 5 · humanized ContactRole label ("owner" / "front desk" / "booking")
   * rendered as a prefix tag. Absent when the stored role is UNKNOWN.
   */
  role?: string;
  /** Issue 5 · true for the business's primary contact (small "primary" tag). */
  primary?: boolean;
  /** Issue 5 · true when the value passed verification (VerifiedStatus VALID). */
  verified?: boolean;
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
  /**
   * E3 · optional sub-section heading this row belongs under (AI research:
   * "Services" · "Summary" · "Compliance cues" · "Opener angle"). The drawer
   * groups consecutive rows sharing a section under one small heading. Absent =
   * ungrouped (every other block's rows).
   */
  section?: string | null;
  /**
   * Issue 13 · render as a label-less full-width prose line — the label is a
   * pure counter ("Cue 1" / "Angle 1") that adds no information. Set explicitly
   * by the builder; the drawer never regex-sniffs labels. The label stays
   * populated for generic consumers (full-page detail, exports).
   */
  prose?: boolean;
  /**
   * Issue 13 · render as a compact chip in a wrapping chip row instead of a
   * key/value line (the AI brief's Services menu). `label` is the chip text,
   * `value` the hover detail (category). Generic consumers keep label/value.
   */
  chip?: boolean;
  /**
   * AI-brief readability (owner 2026-07-06) · a PAIN/issue line — the drawer
   * highlights it (amber left rule + ink text) so the pitch fuel stands out
   * from neutral prose. Set only on the Opener-angle pain hypotheses.
   */
  pain?: boolean;
  /**
   * AI-brief readability · bold the whole (short) value — verdict-style rows
   * (Sub-type / Sophistication / Pricing transparency) whose value is the
   * information. Never set on sentence values.
   */
  strong?: boolean;
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
  /** true = fired · false = didn't · null = not computable (data absent). */
  matched: boolean | null;
  /**
   * Wave-3 honesty · for a null verdict: TRUE when every research this signal
   * needs already RAN (the data is verified-absent — "scanned · no data"),
   * FALSE when ≥1 backing research never ran ("enrich to unlock"). A null
   * verdict must never invite paying again for a scan that already happened.
   */
  scanned?: boolean;
}

/**
 * One data-domain accordion block. The drawer renders off the honest
 * {@link TypeState}, derived by the SHARED loadTypeStatesForBusinesses loader
 * (the same derivation the workbench matrix reads — 2026-07-06 truth
 * unification, so drawer and workbench can never disagree):
 *   - `enriched` · an enrichment ran and produced data → real `summary` + `rows`
 *   - `empty`    · the enrichment RAN but found nothing (verified) → the calm
 *                  `emptyNote` ("Ran · no active ads found"), never a ghost CTA
 *                  and never re-charged (a completed run IS coverage)
 *   - `failed`   · the enrichment errored → red retry affordance
 *   - `running`  · a QUEUED/RUNNING job (or active cell run) is in flight →
 *                  "enriching…" tag, no CTA
 *   - `not_run`  · never attempted → the ghost "enrich to unlock" card + CTA
 *
 * `listingRows` (E1) is the discovery-derived "listing facts" (GBP aggregate:
 * total reviews / rating / years-on-Google) that are ALWAYS present regardless
 * of whether the family's enrichment ran — they render above the ghost CTA so a
 * discovery-only lead still shows its listing facts, honestly labelled as the
 * listing, not a review pull.
 */
export interface LeadDomainBlock {
  /** Stable key (reviews / tech / speed / meta_ads / google_ads / serp / ai). */
  key: string;
  /** Emoji icon (prototype parity). */
  icon: string;
  /** Section title. */
  title: string;
  /** The honest per-type run state (the shared loader — the source of truth). */
  state: TypeState;
  /** Collapsed-state one-line summary (only when enriched). */
  summary: string | null;
  /** Detail rows shown on expand (only when enriched). */
  rows: LeadEvidenceRow[];
  /**
   * E1 · always-present discovery "listing facts" (GBP aggregate) shown even
   * when this family's enrichment hasn't run. Empty for every block but Reviews.
   */
  listingRows: LeadEvidenceRow[];
  /** Ghost-card note shown when the family was never run (state === not_run). */
  ghostNote: string;
  /**
   * E4/E5 · calm note shown when the enrichment RAN but found nothing
   * (state === empty) — "Ran · no active ads found" — so a verified-empty
   * result never reads as "not enriched". Null falls back to the ghostNote.
   */
  emptyNote: string | null;
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
  /** Scraped Contact-row channels — enrichment output ONLY (never the GBP
   *  discovery scalars; those live in `listingContacts`). */
  phones: LeadContact[];
  emails: LeadContact[];
  socials: LeadContact[];
  /**
   * The discovery GBP phone/email scalars, rendered as LISTING facts (the
   * contacts analogue of the reviews block's `listingRows`) — always shown when
   * present, honestly labelled "From the Google listing", never as proof the
   * contacts enrichment ran. Deduped against the scraped values above.
   */
  listingContacts: LeadContact[];
  /** The honest CONTACTS run state (shared loader) — drives the contacts strip:
   *  not_run → ghost + CTA · empty → "Scanned · none found" · failed → retry ·
   *  running → in-flight note · enriched → the real strip. */
  contactsState: TypeState;
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
    reviewAgg,
    coverageRows,
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
        // E2 · crawlability / server-render signal (true = content in raw
        // pre-JS HTML → crawlable; false = JS-only shell → indexing risk).
        contentWithoutJs: true,
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
      // Issue 5 · role / isPrimary / verifiedStatus feed the grouped contacts
      // UI (role prefix, "primary" tag, verified cue). Bounded — a scrape-heavy
      // lead no longer ships every row to the client.
      select: {
        channel: true,
        value: true,
        role: true,
        isPrimary: true,
        verifiedStatus: true,
      },
      take: 30,
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
    // AUDIT §4 · E1 · reviews RUN-state + reply-rate come from REAL Review rows,
    // never `reviewCount` (a discovery GBP aggregate present on every business —
    // the old false-positive). `_count` = pulled reviews; `ownerReplied` sum via
    // a filtered count gives the reply rate over the actual pull.
    prisma.review.groupBy({
      by: ["ownerReplied"],
      where: { businessId },
      _count: { _all: true },
    }),
    // THE shared run-state loader (coverage-matrix.ts) — the SAME derivation
    // the workbench matrix reads (jobs incl. QUEUED/RUNNING, cell AdMarketRun
    // for META/SERP, active-run cellRunning, real-row presence → the canonical
    // deriveTypeStates). One derivation, every surface (2026-07-06 truth
    // unification) — this loader must never re-derive privately.
    loadTypeStatesForBusinesses(
      [{ id: business.id, cellKey: business.cellKey }],
      agencyId,
    ),
  ]);

  // The honest per-type run states for this business (the loader returns a row
  // for every business it was given).
  const typeStates = coverageRows.get(business.id)!.typeStates;

  // ── Contacts → phones / emails / socials ──
  const phones: LeadContact[] = [];
  const emails: LeadContact[] = [];
  const socials: LeadContact[] = [];
  const seenContact = new Set<string>();
  for (const c of contacts) {
    const dedupeKey = `${c.channel}:${c.value}`;
    if (seenContact.has(dedupeKey)) continue;
    seenContact.add(dedupeKey);
    // Issue 5 · role prefix ("owner" / "front desk"), primary tag, verified
    // cue — the metadata a grouped contacts UI needs to differentiate values.
    const roleLabel = contactRoleLabel(c.role);
    const meta: Pick<LeadContact, "role" | "primary" | "verified"> = {
      ...(roleLabel ? { role: roleLabel } : {}),
      ...(c.isPrimary ? { primary: true } : {}),
      ...(c.verifiedStatus === "VALID" ? { verified: true } : {}),
    };
    if (c.channel === "PHONE" || c.channel === "WHATSAPP") {
      phones.push({ value: c.value, href: `tel:${c.value}`, ...meta });
    } else if (c.channel === "EMAIL") {
      emails.push({ value: c.value, href: `mailto:${c.value}`, ...meta });
    } else if (
      c.channel === "FACEBOOK" ||
      c.channel === "INSTAGRAM" ||
      c.channel === "LINKEDIN" ||
      c.channel === "TIKTOK" ||
      c.channel === "YOUTUBE" ||
      c.channel === "X" ||
      c.channel === "YELP"
    ) {
      // E6 · a compact linked handle: "@handle" parsed from the URL when
      // possible, else the platform name. The channel drives the strip's icon.
      socials.push({
        value: socialHandle(c.channel, c.value),
        href: c.value,
        channel: c.channel,
        ...meta,
      });
    }
  }
  // The discovery GBP scalars are LISTING facts (free discovery data), never
  // proof the contacts enrichment ran — they render as "From the Google
  // listing" (the reviews listingRows pattern), deduped against the scrape.
  const listingContacts: LeadContact[] = [];
  if (business.phone && !phones.some((p) => p.value === business.phone)) {
    listingContacts.push({
      value: business.phone,
      href: `tel:${business.phone}`,
    });
  }
  if (business.email && !emails.some((e) => e.value === business.email)) {
    listingContacts.push({
      value: business.email,
      href: `mailto:${business.email}`,
    });
  }
  const contactsState = typeStates.CONTACTS;

  // ── CMS built-on + tech presence (for the Website & tech accordion) ──
  const cms = techs.find((t) => t.category === "CMS")?.name ?? null;
  const hasPixel = techs.some((t) => t.category === "PIXEL");
  const hasAnalytics = techs.some((t) => t.category === "ANALYTICS");
  const hasBooking = techs.some((t) => t.category === "BOOKING");
  const hasChat = techs.some((t) => t.category === "CHAT");
  const techScanned = techs.length > 0;

  // ── Reviews / rating / perf (latest snapshot wins, else Business scalar) ──
  // reviewCount / rating are the discovery GBP aggregate — the LISTING facts,
  // always present regardless of whether reviews were pulled (audit E1).
  const reviewCount = snapshot?.reviewCount ?? business.reviewCount ?? null;
  const rating = snapshot?.rating ?? business.rating ?? null;
  const perf = audit?.performance ?? null;

  // ── E1 · reviews reply-rate from the REAL pulled Review rows (not reviewCount).
  // reviewAgg is grouped by ownerReplied → { true: replied, false: unreplied }.
  const repliedPulled = reviewAgg
    .filter((g) => g.ownerReplied)
    .reduce((n, g) => n + g._count._all, 0);
  const pulledReviews = reviewAgg.reduce((n, g) => n + g._count._all, 0);
  const replyRatePct =
    pulledReviews > 0
      ? Math.round((repliedPulled / pulledReviews) * 100)
      : null;

  // ── Ads ── Meta and Google are SEPARATE blocks (distinct sources; never
  // merged). Track each platform's active-creative set + "currently running".
  const metaAds = ads.filter((a) => a.platform === "META");
  const googleAds = ads.filter((a) => a.platform === "GOOGLE");
  const metaRunsAds = metaAds.some((a) => a.isActive);
  const googleRunsAds = googleAds.some((a) => a.isActive);

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
        const matched = result.perSignal[sig.key] ?? null;
        // Wave-3 honesty · a null verdict splits by whether the signal's
        // backing researches RAN: ran → "scanned · no data" (never a re-pay
        // CTA), not ran → "enrich to unlock".
        let scanned: boolean | undefined;
        if (matched === null) {
          const tokens = researchesForSignals([{ key: sig.key }]);
          scanned =
            tokens.length > 0 &&
            tokens.every((t) => {
              const key = typeKeyForEnrichToken(t);
              return key != null && typeStates[key] !== "not_run";
            });
        }
        return {
          key: sig.key,
          title: meta?.title ?? signalKeyLabel(sig.key),
          means: meta?.means ?? "",
          matched,
          ...(scanned !== undefined ? { scanned } : {}),
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
  const complianceFlag =
    hipaaFinding ||
    ((metaRunsAds || googleRunsAds) && techScanned && !hasPixel);

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

  // ── Data-domain accordions · honest per-TYPE run state (truth unification) ──
  // Every block's `state` comes from the SHARED loader's deriveTypeStates — the
  // exact states the workbench matrix shows. `*Enriched` locals are pure
  // conveniences (state === "enriched") gating the content rows; the loader's
  // presence split guarantees the backing rows exist whenever a state reads
  // "enriched".
  const reviewsState = typeStates.REVIEWS;
  const reviewsEnriched = reviewsState === "enriched";
  // TECH folds the CONTACTS job inside deriveTypeStates (tech rides the same
  // DOM fetch — dispatch never emits TECH job rows), so a completed contacts
  // scan that found no tech reads "empty", never a re-pay ghost.
  const techState = typeStates.TECH;
  const techEnriched = techState === "enriched";
  const speedState = typeStates.LIGHTHOUSE;
  const speedEnriched = speedState === "enriched";
  // Meta and Google ads are SEPARATE blocks with separate run rails (Meta =
  // cell-scoped AdMarketRun; Google = per-business job rows ONLY — the
  // cell-keyed GOOGLE telemetry pollution is excluded by the loader).
  const metaAdsState = typeStates.META_ADS;
  const metaAdsEnriched = metaAdsState === "enriched";
  const googleAdsState = typeStates.GOOGLE_ADS;
  const googleAdsEnriched = googleAdsState === "enriched";
  const serpState = typeStates.SERP;
  const serpEnriched = serpState === "enriched";
  // The AI brief rolls up SERVICES + AI_RESEARCH (the ai_brief data group) —
  // a DONE AI job with no rows now reads "empty" (Ran · none found) instead of
  // a re-pay ghost, and a FAILED one gets the retry affordance.
  const aiBriefState = rollUpGroupState(typeStates, dataGroupFor("ai_brief"));
  const aiBriefEnriched = aiBriefState === "enriched";

  // WP6-9 · per-block provenance — the retrieval date backing each domain, so
  // every evidence block reads "{source} · as of {date}". Nulls degrade to the
  // source line alone (or nothing when not enriched).
  const latestSeen = (rows: typeof ads) =>
    rows
      .map((a) => a.lastSeenAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
  const metaAdsLastSeen = latestSeen(metaAds);
  const googleAdsLastSeen = latestSeen(googleAds);

  // E1 · the LISTING facts — always present from discovery (GBP aggregate),
  // shown whether or not reviews were pulled. Labelled as the listing, not a
  // review pull. These render ABOVE the review-enrichment ghost/data.
  const reviewListingRows: LeadEvidenceRow[] = [
    {
      label: "Total reviews",
      value: reviewCount != null ? reviewCount.toLocaleString() : "—",
      // WP5-11 · vs-cell bar when the workbench has a "reviews" band.
      metric:
        reviewCount != null
          ? { value: reviewCount, bandKey: "reviews" as const }
          : null,
    },
    ...(rating != null
      ? [
          {
            label: "Rating",
            value: `${rating.toFixed(1)}★`,
            metric: { value: rating, bandKey: "rating" as const, unit: "★" },
          },
        ]
      : []),
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
  ];

  // E1 · the review-ENRICHMENT rows (reply rate, unanswered ≤2★, lifecycle,
  // negative themes) — real only after an actual reviews pull. Reply rate is
  // owner-replied ÷ pulled reviews (never the GBP aggregate).
  const reviewEnrichmentRows: LeadEvidenceRow[] = reviewsEnriched
    ? [
        {
          label: "Reply rate",
          value:
            replyRatePct != null
              ? `${replyRatePct}% · ${repliedPulled}/${pulledReviews} replied`
              : "—",
          // Below the ~89% category benchmark reads amber (a pitch angle).
          tone:
            replyRatePct != null && replyRatePct < 80 ? ("a" as const) : null,
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
    : [];

  // E2 · a crawlability / server-render signal from the audit's contentWithoutJs
  // (true = content in raw pre-JS HTML → crawlable; false = JS-only shell →
  // indexing risk). Null when the DOM-fetch leg didn't run → row omitted.
  const crawlRow: LeadEvidenceRow[] =
    audit?.contentWithoutJs != null
      ? [
          {
            label: "Crawlable (no-JS)",
            value: audit.contentWithoutJs
              ? "Yes · server-rendered"
              : "No · JS-only shell",
            tone: audit.contentWithoutJs ? null : ("r" as const),
          },
        ]
      : [];

  const domains: LeadDomainBlock[] = [
    {
      key: "reviews",
      icon: "⭐",
      title: "Reviews",
      state: reviewsState,
      // Summary shows the listing facts (always) + the pull result when enriched.
      summary: `${reviewCount != null ? reviewCount.toLocaleString() : "—"} · ${
        rating != null ? `${rating.toFixed(1)}★` : "—"
      }${
        reviewsEnriched && replyRatePct != null
          ? ` · ${replyRatePct}% replies`
          : ""
      }`,
      // Enrichment rows only (reply rate / unanswered / lifecycle) — the listing
      // facts live in listingRows so they always show, honestly labelled.
      rows: reviewEnrichmentRows,
      listingRows: reviewListingRows,
      ghostNote:
        "Listing facts above are from Google's profile. Pull the actual reviews to see reply rate, unanswered negatives, and themes — the pitch fuel.",
      emptyNote:
        "Reviews pulled — none on file yet. Listing facts above are from the Google profile.",
      source: reviewsEnriched ? "Google reviews" : null,
      asOf: reviewsEnriched ? isoDay(snapshot?.snapshotDate) : null,
    },
    {
      key: "tech",
      icon: "🖥️",
      title: "Website & tech",
      state: techState,
      summary: techEnriched
        ? // "Custom / unknown" everywhere the scan found no CMS — a bare
          // "Custom" claims more certainty than the scan supports.
          `${cms ?? "Custom / unknown"}${!hasPixel ? " · no pixel" : ""} · booking ${hasBooking ? "online" : "phone"}`
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
      listingRows: [],
      ghostNote:
        "Scan the site's tech stack — CMS, pixel, analytics, and booking gaps open the pitch.",
      emptyNote:
        "Website scanned — no tech stack detected (site may be down or blocking scanners).",
      source: techEnriched ? "Website scan" : null,
      asOf: null,
    },
    {
      key: "speed",
      icon: "⚡",
      title: "Site speed",
      state: speedState,
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
            // E2 · the audit's SEO score — SELECTED here for months but never
            // rendered. Same red-under-70 tone as accessibility.
            ...(audit?.seo != null
              ? [
                  {
                    label: "SEO",
                    value: `${Math.round(audit.seo)}/100`,
                    tone: audit.seo < 70 ? ("r" as const) : null,
                  },
                ]
              : []),
            // E2 · crawlability / server-render signal (contentWithoutJs).
            ...crawlRow,
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
      listingRows: [],
      ghostNote:
        "Run a mobile Lighthouse audit — slow sites lose high-intent clicks before the page loads.",
      emptyNote:
        "Lighthouse ran — no score returned (site unreachable or blocked the audit).",
      source: speedEnriched ? "Lighthouse mobile" : null,
      asOf: speedEnriched ? isoDay(audit?.auditedAt) : null,
    },
    {
      key: "meta_ads",
      icon: "📣",
      title: "Meta ads",
      state: metaAdsState,
      summary: metaAdsEnriched
        ? `${metaAds.length} active${metaRunsAds ? "" : " · paused"}`
        : null,
      rows: metaAdsEnriched
        ? [
            {
              label: "Active Meta ads",
              value: `${metaAds.length} creative${metaAds.length === 1 ? "" : "s"}${metaRunsAds ? "" : " · paused"}`,
              tone: metaRunsAds ? ("g" as const) : null,
              metric: { value: metaAds.length, bandKey: "meta_ads" as const },
            },
            ...(Array.from(
              new Set(
                metaAds
                  .map((a) => a.displayFormat)
                  .filter((v): v is string => !!v),
              ),
            ).join(" · ")
              ? [
                  {
                    label: "Formats",
                    value: Array.from(
                      new Set(
                        metaAds
                          .map((a) => a.displayFormat)
                          .filter((v): v is string => !!v),
                      ),
                    ).join(" · "),
                  },
                ]
              : []),
          ]
        : [],
      listingRows: [],
      ghostNote:
        "Scan the Meta Ad Library — active creatives, spend bands, and formats.",
      // A scanned cell that matched 0 advertisers is a VERIFIED empty, not a
      // never-run — calm, not an enrich CTA.
      emptyNote: "Meta Ad Library scanned — no active ads for this business.",
      source: metaAdsEnriched ? "Meta Ad Library" : null,
      asOf: metaAdsEnriched ? isoDay(metaAdsLastSeen) : null,
    },
    {
      key: "google_ads",
      icon: "📣",
      title: "Google ads",
      state: googleAdsState,
      summary: googleAdsEnriched
        ? `${googleAds.length} active${googleRunsAds ? "" : " · paused"}`
        : null,
      rows: googleAdsEnriched
        ? [
            {
              label: "Active Google ads",
              value: `${googleAds.length} creative${googleAds.length === 1 ? "" : "s"}${googleRunsAds ? "" : " · paused"}`,
              tone: googleRunsAds ? ("g" as const) : null,
              metric: {
                value: googleAds.length,
                bandKey: "google_ads" as const,
              },
            },
          ]
        : [],
      listingRows: [],
      ghostNote:
        "Scan the Google Ads Transparency Center — active search & display ads (reliable per-business attribution).",
      emptyNote:
        "Google Ads Transparency scanned — no active ads for this business.",
      source: googleAdsEnriched ? "Google Ads Transparency" : null,
      asOf: googleAdsEnriched ? isoDay(googleAdsLastSeen) : null,
    },
    {
      key: "serp",
      icon: "🔍",
      title: "Search rank",
      state: serpState,
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
      listingRows: [],
      ghostNote:
        "Scan the local 3-pack + organic ranks — visibility gaps are an easy first pitch.",
      // E4 · SERP runs cell-wide; a non-ranking lead has no SerpResult row. That
      // is a RAN result ("not ranking"), not a never-run.
      emptyNote:
        "Local search scanned — this business isn't ranking in the local pack.",
      source: serpEnriched ? "Google Search" : null,
      asOf: serpEnriched ? isoDay(serp?.scannedAt) : null,
    },
    {
      // Services folds into the AI brief — one door, one block. The services
      // list renders as a "Services" sub-section above the AI read.
      key: "ai",
      icon: "🧠",
      title: "AI brief",
      state: aiBriefState,
      summary: aiBriefEnriched
        ? [research?.subType, research?.sophistication]
            .filter(Boolean)
            .join(" · ") || "Positioning · pricing · pain hypotheses"
        : null,
      // E3 · restructured into labelled sub-sections. `section` groups the rows
      // (Services · Summary · Compliance cues · Opener angle) so the drawer
      // renders headed groups instead of a flat list. Services folded in
      // (2026-07-05) — the menu the site lists, above the AI read.
      // Issue 13 · Services render as chips (a menu is chips, not key/values);
      // the five summary rows (Sub-type / Sophistication / Pricing transparency
      // / Positioning / Vs cell leader) share one fixed-label kv grid; the
      // counter-labelled Cue/Angle rows are label-less prose lines.
      rows: aiBriefEnriched
        ? [
            // ── Services (the menu detected on the site) · chips ──
            ...services.map((s) => ({
              label: s.name,
              value: s.category ?? "—",
              section: "Services" as const,
              chip: true,
            })),
            // ── Summary (fixed-label kv rows) · short verdict values render
            // BOLD (`strong`) — the value IS the information (owner 2026-07-06:
            // "no highlights, no bold text"). Sentence rows stay normal weight.
            ...(research?.subType
              ? [
                  {
                    label: "Sub-type",
                    value: research.subType,
                    section: "Summary" as const,
                    strong: true,
                  },
                ]
              : []),
            ...(research?.sophistication
              ? [
                  {
                    label: "Sophistication",
                    value: research.sophistication,
                    section: "Summary" as const,
                    strong: true,
                  },
                ]
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
                    section: "Summary" as const,
                    strong: true,
                  },
                ]
              : []),
            ...(research?.positioningSummary
              ? [
                  {
                    label: "Positioning",
                    value: research.positioningSummary,
                    section: "Summary" as const,
                  },
                ]
              : []),
            ...(research?.competitivePositioning
              ? [
                  {
                    label: "Vs cell leader",
                    value: research.competitivePositioning,
                    section: "Summary" as const,
                  },
                ]
              : []),
            // ── Compliance cues · these are SHORT TAGS by construction (the
            // ER-3 prompt caps them at ≤5 words: "medical-director-required",
            // "HIPAA") — render as amber warning CHIPS, not full-width prose
            // lines that read like broken sentences. Dashes humanized.
            ...(research?.complianceCues ?? []).map((c) => ({
              label: c.replace(/-/g, " "),
              value: "—",
              section: "Compliance cues" as const,
              chip: true,
              tone: "a" as const,
            })),
            // ── Opener angle (the outreach pain hypotheses) · the pitch fuel —
            // each line gets the PAIN highlight (amber rule + ink text) so the
            // issues stand out from neutral prose (owner 2026-07-06).
            ...(research?.painHypotheses ?? []).map((p, i) => ({
              label: `Angle ${i + 1}`,
              value: p,
              section: "Opener angle" as const,
              prose: true,
              pain: true,
            })),
          ]
        : [],
      listingRows: [],
      ghostNote:
        "Services they list + an AI read on positioning, pricing transparency, and pain hypotheses — how to pitch this business.",
      emptyNote:
        "AI brief ran — no services or readable positioning found on this site.",
      source: aiBriefEnriched ? "AI analysis of public sources" : null,
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

  const addressLine = formatAddressLine([
    business.address,
    business.city,
    business.province,
    business.country,
  ]);

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
    listingContacts,
    contactsState,
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

/**
 * Issue 5 · humanized ContactRole label rendered as a contact-value prefix.
 * UNKNOWN (the default) → null — no tag, most scraped contacts are unknown.
 */
function contactRoleLabel(role: string): string | null {
  switch (role) {
    case "OWNER":
      return "owner";
    case "FRONT_DESK":
      return "front desk";
    case "PERSONAL":
      return "personal";
    case "GENERIC":
      return "generic";
    case "SUPPORT":
      return "support";
    case "BOOKING":
      return "booking";
    case "SOCIAL":
      return "social";
    default:
      return null;
  }
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

/**
 * C2 · one address line without duplicated components. `business.address` is
 * DataForSEO's FULL formatted address (already includes city + region), so
 * naively appending city/province/country double-prints ("…, Kelowna, BC …,
 * Kelowna, British Columbia, CA"). We keep the richest first component and only
 * append a later component when its normalized form isn't already present as a
 * comma-delimited TOKEN of the accumulated line — token-based (not substring)
 * so a city that merely appears inside a street name isn't wrongly dropped.
 * Case-insensitive. Empty → "—".
 */
export function formatAddressLine(
  parts: readonly (string | null | undefined)[],
): string {
  const norm = (s: string): string => s.trim().toLowerCase();
  const kept: string[] = [];
  const seenTokens = new Set<string>();

  for (const raw of parts) {
    if (!raw) continue;
    const value = raw.trim();
    if (!value) continue;
    if (seenTokens.has(norm(value))) continue; // whole component already there

    kept.push(value);
    // Register every comma-delimited token of the accepted component so a later
    // component matching any of them (e.g. "Kelowna" inside the full address) is
    // skipped.
    for (const tok of value.split(",")) {
      const t = norm(tok);
      if (t) seenTokens.add(t);
    }
  }

  return kept.join(", ") || "—";
}

/** Social-channel display label ("Instagram", "Facebook", …). The href carries
 *  the full URL; the chip shows the platform name. */
function socialLabel(channel: string): string {
  return channel.charAt(0) + channel.slice(1).toLowerCase();
}

/**
 * E6 · a compact linked-handle label for a social channel. Parses the last
 * meaningful path segment of the URL into an "@handle" (e.g.
 * instagram.com/soleaspa → "@soleaspa"); falls back to the platform name when
 * the URL has no usable handle. Pure + defensive (bad URLs → platform name).
 */
export function socialHandle(channel: string, url: string): string {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    // Skip known non-handle prefixes some platforms use in their paths, plus
    // Facebook script/redirect segments (facebook.com/profile.php?id=NNN puts
    // the real id in the query, so the path segment "profile.php" is NOT a
    // handle — C1). Case-insensitive.
    const skip = new Set([
      "in",
      "company",
      "channel",
      "user",
      "c",
      "@",
      // Facebook non-vanity script/redirect segments
      "profile.php",
      "pages",
      "people",
      "pg",
      "p",
    ]);
    const seg = segs.find((s) => {
      const lower = s.toLowerCase();
      if (skip.has(lower)) return false;
      // Any remaining segment carrying a "." is a page script / file, never a
      // handle (e.g. "*.php", "*.html", other dotted paths).
      if (lower.includes(".")) return false;
      return true;
    });
    if (seg) {
      const handle = decodeURIComponent(seg).replace(/^@/, "");
      if (handle.length > 0 && handle.length <= 40) return `@${handle}`;
    }
  } catch {
    // fall through to the platform name
  }
  return socialLabel(channel);
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
