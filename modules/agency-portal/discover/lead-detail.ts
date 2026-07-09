// modules/agency-portal/discover/lead-detail.ts · the SHARED, agency-scoped
// loader for the single-lead deep view. ONE loader, two consumers:
//   - the LeadDrawer (client, opened from the workbench via ?lead=<businessId>)
//   - the full-page business detail route (server)
// so the drawer and the page never diverge.
//
// `getLeadDetail(businessId, agencyId)` returns a PLAIN, fully serializable
// `LeadDetail` (no functions, no Date objects — ISO strings only) shaped to the
// drawer's portal-flat sections (2026-07 restructure):
//   1. header   · logo / name / address / category / rating / reviews /
//                 open-status + pills (reachable · match · status · compliance ·
//                 closed)
//   2. why      · signal verdicts + fired composites + angles + expert findings
//   3. contacts · scraped Contact rows (w/ per-value provenance) + GBP listing
//                 scalars, state-gated off the honest CONTACTS run state
//   4. data     · Reviews / Website&tech / Site speed / Meta ads / Google ads /
//                 Search / AI brief — each rendered off its honest run STATE
//                 (from the SHARED loadTypeStatesForBusinesses loader):
//                 enriched / empty / failed / running / not_run — plus the
//                 always-free Profile (GBP listing facts) and Nearby rivals
//                 (peopleAlsoSearch) blocks
//   5. touches  · this lead's OutreachDraft sequence
//   6. footer   · the action surface (rendered client-side)
//
// AGENCY-SCOPED: a business is only returned when it lives in one of the calling
// agency's discovered cells. Cross-agency / missing → null. No external API in
// the request path — every field reads an already-enriched DB row
// (`.claude/rules/security.md`, `.claude/rules/cost-discipline.md`).

import prisma from "@/lib/prisma";
import { entitlementBillingEnabled } from "@/modules/cost/flags";
import { loadEntitlements } from "@/modules/discovery/entitlements";
import type { IconName } from "@/components/agency/Icon";
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
  /**
   * Per-value provenance from Contact.source + confidence — the short trust
   * label rendered beside the value ("tel: link · 95%" vs "homepage · 60%") so
   * Tom knows how sure we are before a cold dial. Absent on GBP listing rows.
   */
  provenance?: string;
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
  /**
   * Drawer content pass (2026-07) · a pulled-review QUOTE line. `value` is the
   * truncated quoted text, `label` the meta ("5★ · Jul 2 · owner replied").
   * The drawer renders an indented quote; generic consumers (full-page detail,
   * Proof Pack) keep the label/value form.
   */
  quote?: boolean;
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
  /**
   * F4 honesty · a roadmap signal's null verdict is a THIRD state: the data
   * source doesn't exist yet, so neither "scanned · no data" nor an enrich CTA
   * is honest (researchesForSignals now skips roadmap signals, so the scanned
   * split above would misread it as "enrich to unlock").
   */
  roadmap?: boolean;
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
  /** Icon name (components/agency/Icon) — no emoji per copy-voice.md; Meta and
   *  Google ads carry DISTINCT glyphs (megaphone vs "G"). */
  icon: IconName;
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

/**
 * One "people also search" rival (Business.peopleAlsoSearch — free discovery
 * data). Powers the drawer's "Nearby rivals" block: name + rating + review
 * count, the "you're losing to X (136 reviews)" pitch at zero cost.
 */
export interface LeadRival {
  name: string;
  rating: number | null;
  reviewCount: number | null;
}

/**
 * The always-free GBP Profile block rendered inside the drawer's Data section
 * (microlabel-headed). Rows carry photos / claimed / years-on-Google (tenure
 * band) / hours-derived open-days / notable attributes; `description` is the
 * owner's own GBP pitch (drawer truncates + expands); `mapsUrl` is the direct
 * Maps listing link (Business.checkUrl).
 */
export interface LeadProfile {
  rows: LeadEvidenceRow[];
  description: string | null;
  mapsUrl: string | null;
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
  /** Google-hosted logo (Business.logoUrl) — header avatar; null degrades to
   *  no avatar (never a placeholder box). */
  logoUrl: string | null;
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
   * pain-count heuristic. Drives the match pill's measured-vs-derived tooltip.
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
  // ── 6. Data-domain blocks ──
  domains: LeadDomainBlock[];
  /** Always-free GBP Profile block (photos / claimed / years / hours /
   *  attributes / description / Maps link) — Data section, listing-labelled. */
  profile: LeadProfile;
  /** Top-5 "people also search" rivals (free discovery data) — the drawer's
   *  Nearby rivals block. Empty when Google surfaced none. */
  rivals: LeadRival[];
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
 * per-lead verdict for each chosen signal, and the match pill reflects the REAL
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
      // Drawer content pass (2026-07) · free GBP payloads with zero prior
      // surface: logo avatar, owner-written description, direct Maps link,
      // weekly hours, notable attributes, star distribution, named rivals,
      // GBP booking-link flag, last-review recency.
      logoUrl: true,
      description: true,
      checkUrl: true,
      hours: true,
      attributes: true,
      ratingDistribution: true,
      peopleAlsoSearch: true,
      gbpHasBooking: true,
      lastReviewAt: true,
      latestReviewPostedAt: true,
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
    brandSerp,
    services,
    research,
    reviewAgg,
    recentReviews,
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
        // Drawer content pass · rounds out the 4-score Lighthouse read Tom
        // quotes verbatim, plus the freeze metrics (TBT/FCP; INP was already
        // selected but never rendered).
        bestPractices: true,
        seo: true,
        lcp: true,
        cls: true,
        inp: true,
        tbt: true,
        fcp: true,
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
        // Drawer content pass · provenance ("tel: link · 95%" vs "homepage ·
        // 60%") sets trust per value before a cold dial.
        source: true,
        confidence: true,
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
      where: { businessId, ownerReplied: false, stars: { lte: 3 } },
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
      // WP6-9 · scannedAt provenance for the Search block. pack1–3Name are the
      // named 3-pack rivals ("the pack that beats you: X, Y, Z").
      select: {
        localPackRank: true,
        organicRank: true,
        kind: true,
        scannedAt: true,
        pack1Name: true,
        pack2Name: true,
        pack3Name: true,
      },
    }),
    // Drawer content pass · the latest brand-query scan — "a competitor bids on
    // your name" (isBrandQuery + paidBidders) is the highest-converting search
    // pitch. Null when no brand query was ever scanned.
    prisma.serpResult.findFirst({
      where: { businessId, isBrandQuery: true },
      orderBy: { scannedAt: "desc" },
      select: { paidBidders: true, scannedAt: true },
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
    // Drawer content pass · 2–3 recent pulled-review quotes — the opener
    // material Tom used to tab out to Google Maps for. Bounded + text-only.
    prisma.review.findMany({
      where: { businessId, text: { not: null } },
      orderBy: { postedAt: "desc" },
      take: 3,
      select: { stars: true, text: true, postedAt: true, ownerReplied: true },
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
  // Owner fix (2026-07-06) · phones dedupe on their DIGIT identity (phoneKey —
  // "+1 (208) 965-3777" and "208.965.3777" are ONE number) and every phone
  // renders in ONE display format (formatPhoneDisplay). Emails dedupe
  // case-insensitively. The GBP listing scalars below reuse the same keys so a
  // listing phone matching a scraped row never renders twice.
  const phones: LeadContact[] = [];
  const emails: LeadContact[] = [];
  const socials: LeadContact[] = [];
  const seenContact = new Set<string>();
  for (const c of contacts) {
    const dedupeKey =
      c.channel === "PHONE" || c.channel === "WHATSAPP"
        ? `PHONE:${phoneKey(c.value) ?? c.value}`
        : c.channel === "EMAIL"
          ? `EMAIL:${c.value.trim().toLowerCase()}`
          : `${c.channel}:${c.value}`;
    if (seenContact.has(dedupeKey)) continue;
    seenContact.add(dedupeKey);
    // Issue 5 · role prefix ("owner" / "front desk"), primary tag, verified
    // cue — the metadata a grouped contacts UI needs to differentiate values.
    const roleLabel = contactRoleLabel(c.role);
    const meta: Pick<
      LeadContact,
      "role" | "primary" | "verified" | "provenance"
    > = {
      ...(roleLabel ? { role: roleLabel } : {}),
      ...(c.isPrimary ? { primary: true } : {}),
      ...(c.verifiedStatus === "VALID" ? { verified: true } : {}),
      provenance: contactProvenance(c.source, c.confidence),
    };
    if (c.channel === "PHONE" || c.channel === "WHATSAPP") {
      phones.push({
        value: formatPhoneDisplay(c.value),
        href: `tel:${c.value}`,
        ...meta,
      });
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
  // Owner fix (2026-07-06) · dedupe by DIGIT identity / lowercase email, not
  // exact string — a GBP "+12089653777" matching a scraped "(208) 965-3777"
  // must NOT render twice.
  const listingContacts: LeadContact[] = [];
  if (
    business.phone &&
    !seenContact.has(`PHONE:${phoneKey(business.phone) ?? business.phone}`)
  ) {
    listingContacts.push({
      value: formatPhoneDisplay(business.phone),
      href: `tel:${business.phone}`,
    });
  }
  if (
    business.email &&
    !seenContact.has(`EMAIL:${business.email.trim().toLowerCase()}`)
  ) {
    listingContacts.push({
      value: business.email,
      href: `mailto:${business.email}`,
    });
  }
  const contactsState = typeStates.CONTACTS;

  // ── CMS built-on + tech presence (for the Website & tech block) ──
  const cms = techs.find((t) => t.category === "CMS")?.name ?? null;
  const hasPixel = techs.some((t) => t.category === "PIXEL");
  const hasAnalytics = techs.some((t) => t.category === "ANALYTICS");
  const hasBooking = techs.some((t) => t.category === "BOOKING");
  const hasChat = techs.some((t) => t.category === "CHAT");
  const techScanned = techs.length > 0;
  // Drawer content pass · the NAMED stack ("Cloudflare · Meta Pixel — no
  // analytics") from ALL BusinessTech rows, not just presence booleans —
  // "Meta Pixel present, no Google Analytics" is the sharper attribution pitch.
  const bookingTool = techs.find((t) => t.category === "BOOKING")?.name ?? null;
  const stackNames = Array.from(new Set(techs.map((t) => t.name))).slice(0, 6);
  const stackLine = stackNames.length
    ? `${stackNames.join(" · ")}${!hasAnalytics ? " — no analytics" : ""}`
    : null;

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
  // Drawer content pass · spend band + advertiser name were SELECTED for months
  // but never rendered — the wasted-spend pitch's dollar number.
  const distinct = (values: (string | null)[]): string[] =>
    Array.from(new Set(values.filter((v): v is string => !!v)));
  const metaSpendBands = distinct(metaAds.map((a) => a.spendBandUsd));
  const metaAdvertisers = distinct(metaAds.map((a) => a.advertiserName));
  const googleSpendBands = distinct(googleAds.map((a) => a.spendBandUsd));
  const googleAdvertisers = distinct(googleAds.map((a) => a.advertiserName));

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
        // CTA), not ran → "enrich to unlock". F4 · roadmap signals have NO
        // collectable backing (researchesForSignals skips them) — a third
        // honest state, never an enrich CTA.
        let scanned: boolean | undefined;
        let roadmap: boolean | undefined;
        if (matched === null) {
          if (meta?.status === "roadmap") {
            roadmap = true;
          } else {
            const tokens = researchesForSignals([{ key: sig.key }]);
            scanned =
              tokens.length > 0 &&
              tokens.every((t) => {
                const key = typeKeyForEnrichToken(t);
                return key != null && typeStates[key] !== "not_run";
              });
          }
        }
        return {
          key: sig.key,
          title: meta?.title ?? signalKeyLabel(sig.key),
          means: meta?.means ?? "",
          matched,
          ...(scanned !== undefined ? { scanned } : {}),
          ...(roadmap !== undefined ? { roadmap } : {}),
        };
      });
      // A null-only cohort (nothing computable yet) → no honest %; fall back to
      // the heuristic so the match pill isn't a misleading 0.
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

  // ── "At a glance" fact grid (full-page detail + Proof Pack) ──
  // Style audit (2026-07) · Category + City dropped — both already render in
  // every consumer's header line (duplicated facts were dead ink).
  const facts: LeadFact[] = [
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

  // ── Profile block (Data section) · always-free GBP listing facts ──
  const openDays = openDaysPerWeek(business.hours);
  const attrs = notableAttributes(business.attributes);
  const profile: LeadProfile = {
    rows: [
      ...(business.photosCount != null
        ? [
            {
              label: "Photos",
              value: business.photosCount.toLocaleString(),
              // A near-bare listing (<3 photos) is a profile-neglect wedge.
              tone: business.photosCount < 3 ? ("a" as const) : null,
            },
          ]
        : []),
      {
        label: "Claimed",
        value: business.isClaimed ? "Yes" : "No",
        // Unclaimed GBP = nobody is minding the listing — a classic opener.
        tone: business.isClaimed ? ("g" as const) : ("a" as const),
      },
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
      // Thin hours = capacity ceiling — a growth-pitch wedge at ≤4 days/wk.
      ...(openDays != null
        ? [
            {
              label: "Hours",
              value: `Open ${openDays} day${openDays === 1 ? "" : "s"}/wk`,
              tone: openDays <= 4 ? ("a" as const) : null,
            },
          ]
        : []),
      ...(attrs.length
        ? [{ label: "Attributes", value: attrs.join(" · ") }]
        : []),
    ],
    description: business.description ?? null,
    mapsUrl: business.checkUrl ?? null,
  };

  // ── Nearby rivals (Business.peopleAlsoSearch — free discovery data) ──
  const rivals = rivalsFrom(business.peopleAlsoSearch);

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

  // ── Search extras · named 3-pack rivals + brand-hijack bidders ──
  const packNames = [serp?.pack1Name, serp?.pack2Name, serp?.pack3Name].filter(
    (n): n is string => !!n,
  );
  const brandBidders = paidBiddersFrom(brandSerp?.paidBidders);

  // E1 · the LISTING facts — always present from discovery (GBP aggregate),
  // shown whether or not reviews were pulled. Labelled as the listing, not a
  // review pull. These render ABOVE the review-enrichment ghost/data.
  const distributionLine = ratingDistributionLine(business.ratingDistribution);
  const lastReviewDay = shortDay(
    business.lastReviewAt ?? business.latestReviewPostedAt,
  );
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
            // Owner 2026-07-06 · every judgeable value carries a tone: ≥4.5
            // healthy, <4 a reputation wedge, <3 an emergency.
            tone:
              rating >= 4.5
                ? ("g" as const)
                : rating < 3
                  ? ("r" as const)
                  : rating < 4
                    ? ("a" as const)
                    : null,
            metric: { value: rating, bandKey: "rating" as const, unit: "★" },
          },
        ]
      : []),
    // Drawer content pass · the star split ("111×5★ · 1×4★") tells the real
    // story faster than a bare 5.0; last-review recency is the cheapest
    // is-this-business-alive check. Both are free GBP listing facts.
    // (Years on Google moved to the Profile block — one surface per fact.)
    ...(distributionLine != null
      ? [{ label: "Distribution", value: distributionLine }]
      : []),
    ...(lastReviewDay != null
      ? [
          {
            label: "Last review",
            value: lastReviewDay,
            tone: recencyTone(
              business.lastReviewAt ?? business.latestReviewPostedAt,
            ),
          },
        ]
      : []),
  ];

  // E1 · the review-ENRICHMENT rows (reply rate, 1–3★ unanswered, lifecycle,
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
          // vs the ~89% category benchmark: ≥80 healthy · 40–79 a pitch
          // angle · <40 the owner has abandoned the channel.
          tone:
            replyRatePct == null
              ? null
              : replyRatePct >= 80
                ? ("g" as const)
                : replyRatePct >= 40
                  ? ("a" as const)
                  : ("r" as const),
        },
        ...(snapshot?.reviewLifecycle
          ? [
              {
                label: "Lifecycle (90d)",
                value: lifecycleLabel(snapshot.reviewLifecycle),
                tone: lifecycleTone(snapshot.reviewLifecycle),
              },
            ]
          : []),
        {
          label: "1–3★ unanswered",
          value: negUnanswered.toLocaleString(),
          // 0 = clean (green) · a couple amber · 3+ an open reputation wound.
          tone:
            negUnanswered === 0
              ? ("g" as const)
              : negUnanswered <= 2
                ? ("a" as const)
                : ("r" as const),
        },
        // Drawer content pass · 2–3 recent quotes from the PULLED reviews —
        // opener material, rendered as indented quote lines (`quote: true`).
        ...recentReviews
          .filter((r): r is typeof r & { text: string } => !!r.text)
          .map((r) => ({
            label: `${r.stars}★ · ${shortDay(r.postedAt) ?? ""}${
              r.ownerReplied ? " · owner replied" : " · no reply"
            }`,
            value: `“${truncateText(r.text, 140)}”`,
            section: "Recent reviews" as const,
            quote: true,
          })),
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
            tone: audit.contentWithoutJs ? ("g" as const) : ("r" as const),
          },
        ]
      : [];

  const domains: LeadDomainBlock[] = [
    {
      key: "reviews",
      icon: "star",
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
      icon: "monitor",
      title: "Website & tech",
      state: techState,
      summary: techEnriched
        ? // "Custom / unknown" everywhere the scan found no CMS — a bare
          // "Custom" claims more certainty than the scan supports. Booking
          // phrasing (owner 2026-07-06): "no online booking", never "phone" —
          // a phone is not a booking tool. Matches the workbench cell.
          `${cms ?? "Custom / unknown"}${!hasPixel ? " · no pixel" : ""} · ${hasBooking ? "online booking" : "no online booking"}`
        : null,
      rows: techEnriched
        ? [
            {
              label: "Built on",
              value: cms ?? "Custom / unknown",
              // Amber only for the true DIY tells the diy_platform signal
              // pitches against (Wix/GoDaddy/Squarespace) — WordPress/Shopify
              // are neutral facts.
              tone:
                cms != null &&
                DIY_CMS_TELLS.some((t) => cms.toLowerCase().includes(t))
                  ? ("a" as const)
                  : null,
            },
            // Drawer content pass · the NAMED stack line — sharper than the
            // presence booleans below ("Cloudflare · Meta Pixel — no analytics").
            ...(stackLine != null
              ? [
                  {
                    label: "Stack",
                    value: stackLine,
                    tone: !hasAnalytics ? ("a" as const) : null,
                  },
                ]
              : []),
            {
              label: "Tracking pixel",
              value: hasPixel ? "Present" : "Not detected",
              tone: hasPixel ? ("g" as const) : ("a" as const),
            },
            {
              label: "Analytics",
              value: hasAnalytics ? "Present" : "Not detected",
              tone: hasAnalytics ? ("g" as const) : ("a" as const),
            },
            {
              label: "Live chat",
              // Neutral both ways (plenty of healthy shops skip chat) — toning
              // it would dilute the greens that mean something.
              value: hasChat ? "Present" : "None",
            },
            {
              // Names the incumbent (Square / Vagaro) — Tom pitches against a
              // specific tool, not a boolean. Absence phrasing (owner
              // 2026-07-06): "No online booking" — a phone is not a booking
              // tool. Matches the workbench cell's phrase.
              label: "Online booking",
              value: hasBooking
                ? bookingTool
                  ? `Online · ${bookingTool}`
                  : "Online"
                : "No online booking",
              tone: hasBooking ? ("g" as const) : ("a" as const),
            },
            // GBP-vs-site booking mismatch — one wedge, one line. Only when the
            // GBP flag is known AND it disagrees with the site scan.
            ...(business.gbpHasBooking === true && !hasBooking
              ? [
                  {
                    label: "Booking mismatch",
                    value: "GBP shows a booking link · none detected on site",
                    tone: "a" as const,
                  },
                ]
              : []),
            ...(business.gbpHasBooking === false && hasBooking
              ? [
                  {
                    label: "Booking mismatch",
                    value: `${bookingTool ?? "On-site booking"} not linked from the Google profile`,
                    tone: "a" as const,
                  },
                ]
              : []),
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
      icon: "zap",
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
            // Owner 2026-07-06 · every CWV row carries the full g/a/r read
            // (green when good, not just red when bad) — web-vitals bands.
            ...(audit?.lcp != null
              ? [
                  {
                    label: "LCP",
                    value: `${audit.lcp.toFixed(1)}s`,
                    tone:
                      audit.lcp > 4
                        ? ("r" as const)
                        : audit.lcp > 2.5
                          ? ("a" as const)
                          : ("g" as const),
                  },
                ]
              : []),
            // Drawer content pass · the freeze metrics. INP was selected-but-
            // never-rendered; TBT ("your site freezes for ~2 seconds") and FCP
            // round out the CWV read. Thresholds follow web-vitals bands.
            ...(audit?.inp != null
              ? [
                  {
                    label: "INP",
                    value: `${Math.round(audit.inp)}ms`,
                    tone:
                      audit.inp > 500
                        ? ("r" as const)
                        : audit.inp > 200
                          ? ("a" as const)
                          : ("g" as const),
                  },
                ]
              : []),
            ...(audit?.tbt != null
              ? [
                  {
                    label: "TBT",
                    value: `${Math.round(audit.tbt)}ms blocked`,
                    tone:
                      audit.tbt > 600
                        ? ("r" as const)
                        : audit.tbt > 200
                          ? ("a" as const)
                          : ("g" as const),
                  },
                ]
              : []),
            ...(audit?.cls != null
              ? [
                  {
                    label: "CLS",
                    value: audit.cls.toFixed(2),
                    tone:
                      audit.cls > 0.25
                        ? ("r" as const)
                        : audit.cls > 0.1
                          ? ("a" as const)
                          : ("g" as const),
                  },
                ]
              : []),
            ...(audit?.fcp != null
              ? [
                  {
                    label: "FCP",
                    value: `${audit.fcp.toFixed(1)}s`,
                    tone:
                      audit.fcp > 3
                        ? ("r" as const)
                        : audit.fcp > 1.8
                          ? ("a" as const)
                          : ("g" as const),
                  },
                ]
              : []),
            ...(audit?.accessibility != null
              ? [
                  {
                    label: "Accessibility",
                    value: `${Math.round(audit.accessibility)}/100`,
                    tone: scoreTone(audit.accessibility),
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
                    tone: scoreTone(audit.seo),
                  },
                ]
              : []),
            // Drawer content pass · Best Practices rounds out the 4-score
            // Lighthouse read Tom quotes verbatim in audits.
            ...(audit?.bestPractices != null
              ? [
                  {
                    label: "Best practices",
                    value: `${Math.round(audit.bestPractices)}/100`,
                    tone: scoreTone(audit.bestPractices),
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
                    // Big headroom = big pitch; little left to save = healthy.
                    tone:
                      audit.perfSavingsMs > 3000
                        ? ("r" as const)
                        : audit.perfSavingsMs > 1000
                          ? ("a" as const)
                          : ("g" as const),
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
      icon: "megaphone",
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
              tone: metaRunsAds ? ("g" as const) : ("a" as const),
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
            // Drawer content pass · spend band turns "3 ads" into "≈$1–5K
            // running" — the wasted-spend pitch's dollar number (was selected,
            // never rendered). Advertiser name confirms attribution.
            ...(metaSpendBands.length
              ? [{ label: "Spend band", value: metaSpendBands.join(" · ") }]
              : []),
            ...(metaAdvertisers.length
              ? [{ label: "Advertiser", value: metaAdvertisers.join(" · ") }]
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
      icon: "google",
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
              tone: googleRunsAds ? ("g" as const) : ("a" as const),
              metric: {
                value: googleAds.length,
                bandKey: "google_ads" as const,
              },
            },
            ...(googleSpendBands.length
              ? [{ label: "Spend band", value: googleSpendBands.join(" · ") }]
              : []),
            ...(googleAdvertisers.length
              ? [{ label: "Advertiser", value: googleAdvertisers.join(" · ") }]
              : []),
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
      icon: "search",
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
              ? [
                  {
                    label: "Organic rank",
                    value: `#${serp.organicRank}`,
                    // Page 1 (≤10) healthy · page 2 findable · deeper invisible.
                    tone:
                      serp.organicRank <= 10
                        ? ("g" as const)
                        : serp.organicRank <= 20
                          ? ("a" as const)
                          : ("r" as const),
                  },
                ]
              : []),
            // Drawer content pass · name the enemy — the pack that outranks
            // them is instant pitch credibility.
            ...(packNames.length
              ? [{ label: "The pack", value: packNames.join(" · ") }]
              : []),
            // Brand hijack — "a competitor bids on your name" (verified from a
            // brand-query scan; absent when no brand query was ever scanned).
            ...(brandSerp != null
              ? [
                  {
                    label: "Brand hijack",
                    value: brandBidders.length
                      ? `${brandBidders.length} bidder${brandBidders.length === 1 ? "" : "s"} on their name · ${brandBidders
                          .slice(0, 2)
                          .join(" · ")}`
                      : "None detected on their name",
                    tone: brandBidders.length ? ("r" as const) : ("g" as const),
                  },
                ]
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
      icon: "sparkle",
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
                        : research.pricingTransparency.toLowerCase() ===
                            "transparent"
                          ? ("g" as const)
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

  // Read gate (S9/S11 · entitlement model): the drawer AND the public one-pager
  // (share.ts → getLeadDetail) must not serialize a family THIS agency doesn't
  // own. Raw contacts are the worst leak (a rival's paid phones/emails); domains
  // already reflect the entitlement-gated typeStates via coverage-matrix. No-op
  // when the flag is off.
  let outPhones = phones;
  let outEmails = emails;
  let outSocials = socials;
  let outListingContacts = listingContacts;
  let outDomains = domains;
  if (entitlementBillingEnabled()) {
    const gate = await loadEntitlements(
      agencyId,
      [business.id],
      business.cellKey ? [business.cellKey] : [],
    );
    const ownedBiz = gate.perBusiness.get(business.id);
    const ownedCell = business.cellKey
      ? gate.perCell.get(business.cellKey)
      : undefined;
    if (!(ownedBiz?.has("contacts") ?? false)) {
      outPhones = [];
      outEmails = [];
      outSocials = [];
      outListingContacts = [];
    }
    // Clear the evidence rows on un-entitled research domains so a rival's paid
    // reviews/ads/serp/site data never serializes (the coverage gate already
    // forces state=not_run; this stops the raw bytes leaving the server). The
    // always-honest discovery listingRows + the state stay.
    const DOMAIN_FAMILY: Record<string, string> = {
      reviews: "reviews",
      tech: "tech",
      speed: "lighthouse",
      meta_ads: "meta_ads",
      google_ads: "google_ads",
      serp: "serp",
      ai: "ai_research",
    };
    outDomains = domains.map((d) => {
      const fam = DOMAIN_FAMILY[d.key];
      if (!fam) return d;
      const isCell = fam === "meta_ads" || fam === "serp";
      const owned = isCell
        ? (ownedCell?.has(fam as never) ?? false)
        : (ownedBiz?.has(fam as never) ?? false);
      return owned ? d : { ...d, rows: [], summary: null };
    });
  }

  return {
    businessId: business.id,
    leadId: lead?.id ?? null,
    name: business.name,
    logoUrl: business.logoUrl ?? null,
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
    phones: outPhones,
    emails: outEmails,
    socials: outSocials,
    listingContacts: outListingContacts,
    contactsState,
    firedSignals,
    signalVerdicts,
    angles,
    domains: outDomains,
    profile,
    rivals,
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
 * Tone for a 0–100 Lighthouse category score (a11y / SEO / best practices) —
 * Lighthouse's own bands (90/50), so our color never contradicts the score
 * Tom sees when he re-runs the audit himself.
 */
function scoreTone(score: number): "g" | "a" | "r" {
  if (score >= 90) return "g";
  if (score >= 50) return "a";
  return "r";
}

/**
 * Tone for last-review recency — the cheapest is-this-business-alive check.
 * ≤60d green · 60–180d neutral · ≤1y amber · older red.
 */
function recencyTone(at: Date | null | undefined): "g" | "a" | "r" | null {
  if (!at) return null;
  const days = (Date.now() - at.getTime()) / 86_400_000;
  if (days <= 60) return "g";
  if (days <= 180) return null;
  if (days <= 365) return "a";
  return "r";
}

/** Tone for the review-lifecycle enum (see {@link lifecycleLabel}). */
function lifecycleTone(raw: string): "g" | "a" | "r" | null {
  switch (raw) {
    case "TRENDING":
      return "g";
    case "DYING":
      return "a";
    case "DORMANT":
      return "r";
    default:
      return null;
  }
}

/**
 * The DIY-builder tells the diy_platform signal pitches against. Matched by
 * substring, not equality — the tech fingerprint emits full product names
 * ("GoDaddy Website Builder"), so an exact-match set would miss them.
 */
const DIY_CMS_TELLS = ["wix", "squarespace", "godaddy"] as const;

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

/** All digits of a phone value ("(208) 965-3777" → "2089653777"). */
export function phoneDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Owner fix (2026-07-06) · the phone-IDENTITY key used to dedupe the GBP
 * listing scalar against scraped Contact rows (and scraped rows against each
 * other). NANP-length numbers compare on their LAST 10 digits — so
 * "+1 (208) 965-3777", "12089653777" and "208.965.3777" all collide into one
 * key. Shorter values compare on their full digit string. No digits → null
 * (never matches anything).
 */
export function phoneKey(value: string): string | null {
  const digits = phoneDigits(value);
  if (!digits) return null;
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Owner fix (2026-07-06) · ONE display format for every phone the drawer
 * renders: NANP pretty-print "(208) 965-3777" for 10-digit numbers (and
 * 11-digit numbers with a leading 1 — the +1 is noise for a US/CA product).
 * Anything else (international, extensions, vanity) renders as stored.
 * Idempotent: an already-pretty value re-formats to itself.
 */
export function formatPhoneDisplay(value: string): string {
  const digits = phoneDigits(value);
  const ten =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith("1")
        ? digits.slice(1)
        : null;
  if (!ten) return value.trim();
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * Contact provenance — short trust label from ContactSource + confidence
 * ("tel: link · 95%"). Confidence 0 (unset) drops the percent clause.
 */
export function contactProvenance(source: string, confidence: number): string {
  const label = contactSourceLabel(source);
  return confidence > 0 ? `${label} · ${confidence}%` : label;
}

/** Short human label for a ContactSource enum value. */
function contactSourceLabel(source: string): string {
  switch (source) {
    case "DFS_LISTING":
    case "DFS_MAPS":
      return "Google listing";
    case "SCRAPE_TEL":
      return "tel: link";
    case "SCRAPE_MAILTO":
      return "mailto: link";
    case "SCRAPE_HOMEPAGE":
      return "homepage";
    case "SCRAPE_CONTACT":
      return "contact page";
    case "SCRAPE_ABOUT":
      return "about page";
    case "SCRAPE_TEAM":
      return "team page";
    case "SCRAPE_FOOTER":
      return "site footer";
    case "SCRAPE_JSBUNDLE":
      return "site code";
    case "SCRAPE_JSONLD":
      return "schema markup";
    case "SCRAPE_SOCIAL_META":
      return "social meta";
    case "RDAP":
      return "domain records";
    case "AI_WEB_SEARCH":
      return "web search";
    case "MANUAL":
      return "manual";
    default:
      return source.toLowerCase().replace(/_/g, " ");
  }
}

/**
 * "111×5★ · 1×4★" from Business.ratingDistribution ({1: n, …, 5: n}).
 * Descending stars, zero/absent buckets skipped. Defensive: any non-object /
 * non-numeric shape → null (row omitted).
 */
export function ratingDistributionLine(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const rec = raw as Record<string, unknown>;
  const parts: string[] = [];
  for (const stars of [5, 4, 3, 2, 1]) {
    const v = rec[String(stars)];
    const n =
      typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0)
      parts.push(`${n.toLocaleString()}×${stars}★`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Open days per week from Business.hours (the persisted DfS `work_time`
 * object: work_hours.timetable keyed by weekday → array of open/close spans;
 * a closed day is null/empty). Defensive: unparseable → null (row omitted).
 */
export function openDaysPerWeek(raw: unknown): number | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const wh = (raw as Record<string, unknown>).work_hours;
  if (wh === null || typeof wh !== "object") return null;
  const tt = (wh as Record<string, unknown>).timetable;
  if (tt === null || typeof tt !== "object" || Array.isArray(tt)) return null;
  const days = Object.values(tt as Record<string, unknown>);
  if (days.length === 0) return null;
  return days.filter((v) => Array.isArray(v) && v.length > 0).length;
}

/**
 * Notable GBP attributes from Business.attributes (DfS shape:
 * { available_attributes: { planning: ["appointment_required"], … } }).
 * Pulls the pitch-relevant groups, humanizes snake_case, caps at 4.
 */
export function notableAttributes(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const avail = (raw as Record<string, unknown>).available_attributes;
  if (avail === null || typeof avail !== "object" || Array.isArray(avail))
    return [];
  const groups = ["planning", "service_options", "highlights", "payments"];
  const out: string[] = [];
  for (const group of groups) {
    const items = (avail as Record<string, unknown>)[group];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item === "string" && item.length > 0) {
        out.push(item.replace(/_/g, " "));
        if (out.length >= 4) return out;
      }
    }
  }
  return out;
}

/**
 * Top-5 rivals from Business.peopleAlsoSearch (DfS `people_also_search`:
 * [{ title, rating: { value, votes_count } }]). Defensive per item.
 */
export function rivalsFrom(raw: unknown): LeadRival[] {
  if (!Array.isArray(raw)) return [];
  const out: LeadRival[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!name) continue;
    const rating =
      rec.rating !== null && typeof rec.rating === "object"
        ? (rec.rating as Record<string, unknown>)
        : null;
    out.push({
      name,
      rating: rating && typeof rating.value === "number" ? rating.value : null,
      reviewCount:
        rating && typeof rating.votes_count === "number"
          ? rating.votes_count
          : null,
    });
    if (out.length >= 5) break;
  }
  return out;
}

/** Distinct advertiser domains from SerpResult.paidBidders
 *  ([{ advertiserDomain, headline }]). Defensive per item. */
export function paidBiddersFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const d = (item as Record<string, unknown>).advertiserDomain;
    if (typeof d === "string" && d.length > 0) out.add(d);
  }
  return Array.from(out);
}

/** "Jul 4, 2026" (UTC) for a nullable date — review-recency display. */
export function shortDay(d: Date | null | undefined): string | null {
  if (!d) return null;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Word-safe-ish truncation with a single ellipsis. */
export function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
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
