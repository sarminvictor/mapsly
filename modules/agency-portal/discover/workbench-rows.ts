// modules/agency-portal/discover/workbench-rows.ts · THE one row-builder for
// every workbench surface (2026-07-06 render-architecture refactor).
//
// One pipeline — ONE data pass → per-business maps → `WorkbenchLeadRow[]` +
// touches + stats + bands + coverage — shared by:
//
//   - the discovery workspace page  (`discover/[discoveryId]/page.tsx`)
//   - the saved-list workbench page (`discover/[discoveryId]/lists/[listId]/page.tsx`)
//   - the full-set CSV export route (`api/agency/research/[discoveryId]/export`)
//
// Before this module the three surfaces carried near-verbatim copies of the
// same ~450 lines (9 helper functions copied character-for-character) and had
// already drifted: the list page hardcoded seo/metaAdCount/googleAdCount/
// serpRank/aiSummary/bookingTool to null while its Fields menu still offered
// those columns ("— enrich" over data that exists in the DB), loaded CMS-only
// tech, presence-only ads, and cohort-only bands. ONE builder makes that drift
// class structurally impossible: a row fact is computed here or it doesn't
// exist.
//
// ONE DATA PASS (Step 2 of the refactor): `hydrateWorkbenchData` (signal-eval)
// is the single fetch — it loads every table the signal evaluator reads, with
// a few columns widened for the row-only facts (contact values, finding
// explanations, tech names, ad platforms, AI summaries, CellMetric bands), and
// this builder derives EVERYTHING from that pass: rows, presence sets for the
// coverage matrix (so loadTypeStatesForBusinesses skips its 9 existence
// scans), and the vs-cell reference bands. The old shape ran three overlapping
// passes (~50 round trips) over the same window; this one runs ~half that,
// and the history reads are bounded (latest-row DISTINCT ON + DB-side review
// aggregates — Step 3), so render cost stays flat as cron data accumulates.
//
// Scope stays the caller's job (WHICH businesses/leads make the window — the
// raw-list gate, the lead window, the export batches); this module only turns a
// resolved scope into render-ready plain data (Pattern 4 — no functions cross
// the client boundary; everything returned is serializable).
//
// AGENCY-SCOPED: every query filters by the caller-resolved agencyId where the
// table carries one (leads, drafts); the rest are keyed to the scope's
// businessIds, which the caller already resolved under its own agency check
// (`.claude/rules/security.md`). No external API in the request path.

import prisma, { Prisma } from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import { draftWhereForAgency } from "@/modules/outreach/draft-scope";
import { parseWhyJson } from "./touchpoints";
import { resolveCellBands, type CellReferenceBands } from "./signals";
import {
  anyLeadGroupRan,
  deriveGroupStates,
  type DataGroupKey,
  type EnrichmentTypeKey,
  type TypePresence,
  type TypeState,
} from "./family-coverage";
import {
  loadTypeStatesForBusinesses,
  loadScannedAtMap,
} from "./coverage-matrix";
import {
  mergeSignalVerdicts,
  painGroupClass,
  resolveLeadMatch,
  type CellBand,
  type HeavyRowField,
  type LeadStatus,
  type TouchState,
  type WorkbenchLeadRow,
} from "./leads-workbench";
import {
  hydrateWorkbenchData,
  resolveMatches,
  type ActiveSignal,
} from "./signal-eval";
import { allLibraryActiveSignals } from "./discovery-signals";
import { SIG_META } from "./goal-templates";
import type { WorkbenchTouch } from "./components/TouchpointsTab";
import type { TouchpointStats } from "./components/TouchpointsTab";

// The whole curated signal library as ActiveSignal[] (default thresholds) —
// built ONCE (pure over SIG_META). Every lead is evaluated against it so any
// signal with data on the full cohort becomes filterable (#2).
const ALL_LIB_SIGNALS = allLibraryActiveSignals();

// ── Scope · the resolved window the caller hands in ──────────────────────────

/**
 * The Business select every workbench surface fetches — the union of the row
 * builder's needs AND `hydrateBusinessForSignals`' scalar reads
 * (HYDRATE_BUSINESS_SELECT), so ONE window query feeds both (no second
 * Business read inside the hydration pass).
 */
export const WORKBENCH_BUSINESS_SELECT = {
  id: true,
  name: true,
  address: true,
  city: true,
  cellKey: true,
  rating: true,
  reviewCount: true,
  reachability: true,
  reachableChannelCount: true,
  phone: true,
  email: true,
  website: true,
  // Closed-on-Google flags → the row's "Closed" tag on the Business cell.
  permanentlyClosed: true,
  temporarilyClosed: true,
  // WP6-1 · tenure cohort sample (years-on-Google) for the vs-cell "tenure"
  // band — CellMetric carries no tenure percentile, so this band is
  // cohort-sourced.
  firstSeenOnGoogle: true,
  // ── hydrateBusinessForSignals scalar reads (registry `Business.*` columns +
  //    the cell pre-passes) — selected here so the hydration pass runs over
  //    these rows instead of re-fetching Business itself. ──
  emailVerifiedAt: true,
  instagramHandle: true,
  instagramFollowers: true,
  categories: true,
  category: true,
  province: true,
  country: true,
  photosCount: true,
  isClaimed: true,
  isActive: true,
  yearsOnGoogle: true,
  ownerUserId: true,
  gbpHasBooking: true,
  openStatus: true,
  isHidden: true,
  lastReviewAt: true,
  lastRefreshedAt: true,
  complianceFlags: true,
  metroSlug: true,
  domain: true,
  googleCid: true,
} as const satisfies Prisma.BusinessSelect;

/** One scope business row (the window query's shape). */
export type WorkbenchBusinessRow = Prisma.BusinessGetPayload<{
  select: typeof WORKBENCH_BUSINESS_SELECT;
}>;

/** One saved-list lead + its business (the list window query's shape). */
export interface WorkbenchLeadInput {
  id: string;
  status: string;
  matchScore: number | null;
  contactedAt: Date | null;
  business: WorkbenchBusinessRow;
}

/**
 * The resolved window the builder shapes. `discovery` = the workspace page /
 * whole-market export (rows are businesses; Lead identity is ADOPTED from this
 * discovery's saved lists where one exists). `list` = the saved-list page /
 * list export (rows are the list's leads; status/matchScore come from the Lead
 * rows themselves).
 */
export type WorkbenchScope =
  | { kind: "discovery"; businesses: readonly WorkbenchBusinessRow[] }
  | { kind: "list"; leads: readonly WorkbenchLeadInput[] };

/** Context every build shares. */
export interface WorkbenchBuildCtx {
  agencyId: string;
  discoveryId: string;
  /** The discovery's cellKeys — `[0]` is the primary cell whose CellMetric
   *  seeds the market-true vs-cell bands. */
  cellKeys: readonly string[];
  /** The research's persisted goal signals (drives the REAL match% + the tuned
   *  per-signal verdicts). Empty → heuristic fallback per row. */
  activeSignals: readonly ActiveSignal[];
  /**
   * `page` (default) → the full workbench read-model (rows + touches + stats +
   * bands + coverage + scannedAt).
   * `csv` → rows only, shaped for the streamed export: drafts/coverage/bands/
   * scannedAt are skipped (the CSV never reads them), library verdicts are
   * skipped (the CSV reads only goal keys), and OPTED-OUT contacts are
   * excluded (`Contact.optedOutAt` — an opted-out email/phone never leaves the
   * product in an export; in-app surfaces still show it).
   */
  mode?: "page" | "csv";
  /**
   * Step 4 · the HEAVY row fields to serialize — `heavyFieldsForColumns` over
   * the active column set the `mapsly-wb-cols` cookie reports (pages pass it;
   * no cookie → the goal-default set). Omitted → ALL heavy fields ship (the
   * CSV export needs full rows). Fields outside the set are left ABSENT
   * (undefined) on every row — the client renders a loading cell and hydrates
   * them via getWorkbenchRowFieldsAction when their column toggles on; absent
   * NEVER renders the "— enrich" affordance (that would lie about data that
   * exists in the DB).
   */
  serializeHeavyFields?: ReadonlySet<HeavyRowField>;
}

/** Everything a workbench page renders — plain serializable data (Pattern 4). */
export interface WorkbenchData {
  rows: WorkbenchLeadRow[];
  touches: WorkbenchTouch[];
  stats: TouchpointStats;
  bands: Partial<Record<string, CellBand>>;
  coverageTypeStates: Record<string, Record<EnrichmentTypeKey, TypeState>>;
  scannedAt: Record<string, Partial<Record<DataGroupKey, string>>>;
  /** Businesses the coverage matrix resolved (null in csv mode, which skips
   *  coverage). Drives the header's `enrichedExact`
   *  (`coverageCount >= marketTotal`). */
  coverageCount: number | null;
}

// ── The builder ───────────────────────────────────────────────────────────────

/**
 * Turn a resolved scope (a window of businesses OR a saved list's leads) into
 * the complete workbench read-model. ONE code path for both pages and the CSV
 * export — see the module header for why.
 */
export async function buildWorkbenchRows(
  scope: WorkbenchScope,
  ctx: WorkbenchBuildCtx,
): Promise<WorkbenchData> {
  const mode = ctx.mode ?? "page";
  const isCsv = mode === "csv";
  const businesses =
    scope.kind === "discovery"
      ? scope.businesses
      : scope.leads.map((l) => l.business);
  const businessIds = businesses.map((b) => b.id);
  const activeSignals = ctx.activeSignals;
  const primaryCellKey = ctx.cellKeys[0] ?? null;

  // ── THE data pass + the two workbench-only side loads, in parallel ─────────
  //   - hydrateWorkbenchData · every table the signal evaluator AND the row
  //     builder read, one bounded query each (signal-eval.ts) — plus the
  //     side data (contacts/techs/findings/ad counts/AI summaries/cell refs)
  //     this builder shapes rows from. The primary cell rides along so the
  //     market-true bands resolve even on a window holding none of its rows.
  //   - existing Leads in THIS discovery's saved lists → real leadId + status
  //     (discovery scope only — a list scope already carries its leads)
  //   - OutreachDrafts (Touchpoints tab + per-lead touch state · page mode)
  const [{ hydrated, rowData }, existingLeads, drafts] = await Promise.all([
    hydrateWorkbenchData(businesses, {
      extraCellKeys: !isCsv && primaryCellKey ? [primaryCellKey] : [],
    }),
    scope.kind === "discovery" && businessIds.length > 0
      ? prisma.lead.findMany({
          where: {
            agencyId: ctx.agencyId,
            businessId: { in: businessIds },
            list: { discoveryId: ctx.discoveryId },
          },
          orderBy: { statusChangedAt: "desc" },
          select: {
            id: true,
            businessId: true,
            status: true,
            contactedAt: true,
          },
        })
      : Promise.resolve(
          [] as {
            id: string;
            businessId: string;
            status: string;
            contactedAt: Date | null;
          }[],
        ),
    !isCsv && businessIds.length > 0
      ? prisma.outreachDraft.findMany({
          // WP0-1/WP5 · agency-scoped draft reads (draftWhereForAgency) so a
          // competing agency in a shared market cell can't read this agency's
          // outreach copy.
          where: draftWhereForAgency(ctx.agencyId, businessIds),
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            businessId: true,
            leadId: true,
            channel: true,
            subject: true,
            body: true,
            status: true,
            whyJson: true,
          },
        })
      : Promise.resolve(
          [] as {
            id: string;
            businessId: string;
            leadId: string | null;
            channel: string;
            subject: string | null;
            body: string;
            status: string;
            whyJson: Prisma.JsonValue;
          }[],
        ),
  ]);

  const evalNow = new Date();
  const goalKeySet = new Set(
    activeSignals.map((s) => s.key).filter((k) => SIG_META[k]?.title),
  );

  // Existing Lead per business (most-recently-changed wins) → real id + status.
  // List scope: the scope's own leads ARE the identity.
  const leadByBusiness = new Map<
    string,
    { id: string; status: LeadStatus; contactedAt: Date | null }
  >();
  if (scope.kind === "list") {
    for (const l of scope.leads) {
      leadByBusiness.set(l.business.id, {
        id: l.id,
        status: l.status as LeadStatus,
        contactedAt: l.contactedAt,
      });
    }
  } else {
    for (const l of existingLeads) {
      if (!leadByBusiness.has(l.businessId)) {
        leadByBusiness.set(l.businessId, {
          id: l.id,
          status: l.status as LeadStatus,
          contactedAt: l.contactedAt,
        });
      }
    }
  }

  // AI positioning summary per business. The pipeline embeds `**bold**`
  // emphasis for the drawer — strip the markers here: the table cell + its
  // tooltip are plain-text surfaces.
  const aiSummaryById = new Map<string, string>();
  for (const [id, s] of rowData.aiSummaryByBusiness) {
    aiSummaryById.set(id, s.replaceAll("**", ""));
  }

  // CMS built-on + BOOKING tool (highest-confidence row per category wins —
  // ranked in JS; the hydration pass loads tech unordered).
  const rankedTechs = [...rowData.techs].sort(
    (a, b) => b.confidence - a.confidence,
  );
  const builtOnById = new Map<string, string>();
  const bookingToolById = new Map<string, string>();
  for (const t of rankedTechs) {
    if (t.category === "CMS" && !builtOnById.has(t.businessId))
      builtOnById.set(t.businessId, t.name);
    else if (t.category === "BOOKING" && !bookingToolById.has(t.businessId))
      bookingToolById.set(t.businessId, t.name);
  }

  // Contacts → phones / emails / socials per business (AUDIT E6 · socials were
  // stored as Contact rows but never surfaced).
  const phonesById = new Map<string, string[]>();
  const emailsById = new Map<string, string[]>();
  const socialsById = new Map<string, { channel: string; value: string }[]>();
  for (const c of rowData.contacts) {
    // WP7-2 · opted-out contacts never leave the product in an export.
    if (isCsv && c.optedOutAt != null) continue;
    if (c.channel === "PHONE" || c.channel === "WHATSAPP") {
      push(phonesById, c.businessId, c.value);
    } else if (c.channel === "EMAIL") {
      push(emailsById, c.businessId, c.value);
    } else if (SOCIAL_CHANNELS.has(c.channel)) {
      const arr = socialsById.get(c.businessId) ?? [];
      arr.push({ channel: c.channel, value: c.value });
      socialsById.set(c.businessId, arr);
    }
  }

  // Flagged findings → pain chips per business (most-confident first).
  // `confidence` is a string rank ('high'|'medium'|'low'); a DB orderBy on it
  // sorts alphabetically (high < low < medium — wrong), so rank in JS (WP2-4).
  const rankedFindings = [...rowData.findings].sort(
    (a, b) =>
      (CONFIDENCE_RANK[b.confidence ?? ""] ?? 0) -
      (CONFIDENCE_RANK[a.confidence ?? ""] ?? 0),
  );
  const painsById = new Map<
    string,
    { group: string; label: string; title: string }[]
  >();
  // Strongest pitch angle per business (first finding with one, in
  // most-confident-first order) — the CSV export's "pitch angle" column.
  const pitchById = new Map<string, string>();
  for (const f of rankedFindings) {
    const label = signalKeyLabel(f.signalKey);
    push(painsById, f.businessId, {
      group: f.group,
      label,
      title: f.explanation || f.pitchAngle || label,
    });
    if (f.pitchAngle && !pitchById.has(f.businessId)) {
      pitchById.set(f.businessId, f.pitchAngle);
    }
  }

  // Touch state per business (the most-advanced draft status drives the pill).
  const touchByBusiness = new Map<string, TouchState>();
  for (const d of drafts) {
    const t: TouchState = d.status === "sent" ? "Sent" : "Draft";
    const cur = touchByBusiness.get(d.businessId);
    if (!cur || rankTouch(t) > rankTouch(cur))
      touchByBusiness.set(d.businessId, t);
  }

  // ── Build the workbench rows (one per business) ─────────────────────────────
  const items: readonly {
    business: WorkbenchBusinessRow;
    storedScore: number | null;
  }[] =
    scope.kind === "discovery"
      ? scope.businesses.map((b) => ({ business: b, storedScore: null }))
      : scope.leads.map((l) => ({
          business: l.business,
          storedScore: l.matchScore,
        }));

  // Step 4 · which HEAVY fields ship. No set (csv / full callers) → all.
  const heavySet = ctx.serializeHeavyFields ?? null;
  const keep = (f: HeavyRowField): boolean =>
    heavySet === null || heavySet.has(f);

  const rows: WorkbenchLeadRow[] = items.map(({ business: b, storedScore }) => {
    const hyd = hydrated.get(b.id) ?? null;
    // The hydration pass's latest-snapshot / latest-audit rollups carry the
    // exact fields the old second-pass side-loads re-fetched.
    const snap = (hyd?.snapshot ?? null) as {
      reviewCount: number | null;
      rating: number | null;
    } | null;
    const reviews = snap?.reviewCount ?? b.reviewCount ?? null;
    const rating = snap?.rating ?? b.rating ?? null;
    const perf = hyd?.lighthouse?.performance ?? null;
    const phones = phonesById.get(b.id) ?? (b.phone ? [b.phone] : []);
    const emails = emailsById.get(b.id) ?? (b.email ? [b.email] : []);
    const pains = painsById.get(b.id) ?? [];
    const cell = prettyCell(b.cellKey);
    const lead = leadByBusiness.get(b.id) ?? null;
    // REAL signal eval when the research persisted signals; else fall back to
    // the stored Lead.matchScore (list scope) or the pain-count heuristic.
    const evalResult =
      hyd && activeSignals.length > 0
        ? resolveMatches(activeSignals, hyd, evalNow)
        : null;
    const {
      match,
      matchFromSignals,
      matchDerived,
      perSignal: goalPerSignal,
    } = resolveLeadMatch(evalResult, storedScore, pains.length);
    // #2 · library verdicts (default thresholds) so any signal with data on
    // the whole cohort is filterable; goal (tuned) verdicts win + always kept.
    // csv mode skips the library pass — the CSV reads only goal keys.
    const libPerSignal =
      hyd && !isCsv
        ? resolveMatches(ALL_LIB_SIGNALS, hyd, evalNow).perSignal
        : {};
    const perSignal = mergeSignalVerdicts(
      libPerSignal,
      goalPerSignal,
      goalKeySet,
    );

    return {
      // Real Lead id when this business already lives in a saved list (wired
      // status pill); else the business id keeps the row key unique + the pill
      // reverts gracefully when the action finds no Lead (display-only).
      leadId: lead?.id ?? b.id,
      businessId: b.id,
      name: b.name,
      addr: [b.address ?? b.city ?? "", cell].filter(Boolean).join(" · "),
      cell,
      status: lead?.status ?? "NEW",
      match,
      matchDerived,
      matchFromSignals,
      perSignal,
      pains: pains.map((p, i) => ({
        ...p,
        group: painGroupClass(p.group),
        // Step 4 · only the first TWO chips render their explanation tooltip;
        // the "+N" overflow chip lists labels. Don't ship the long titles
        // beyond index 1 (the CSV reads labels only, so this is export-safe).
        title: isCsv || i < 2 ? p.title : p.label,
      })),
      reachability: b.reachability,
      reachable:
        (b.reachableChannelCount ?? 0) > 0 ||
        phones.length > 0 ||
        emails.length > 0,
      builtOn: builtOnById.get(b.id) ?? null,
      bookingTool: keep("bookingTool")
        ? (bookingToolById.get(b.id) ?? null)
        : undefined,
      website: b.website ?? null,
      pitchAngle: keep("pitchAngle")
        ? (pitchById.get(b.id) ?? null)
        : undefined,
      touch: touchByBusiness.get(b.id) ?? "None",
      lastContactedAt: lead?.contactedAt?.toISOString() ?? null,
      closed: b.permanentlyClosed
        ? ("permanent" as const)
        : b.temporarilyClosed
          ? ("temporary" as const)
          : null,
      reviews,
      rating,
      perf,
      seo: keep("seo") ? (hyd?.lighthouse?.seo ?? null) : undefined,
      metaAdCount: keep("metaAdCount")
        ? (rowData.metaAdCountByBusiness.get(b.id) ?? null)
        : undefined,
      googleAdCount: keep("googleAdCount")
        ? (rowData.googleAdCountByBusiness.get(b.id) ?? null)
        : undefined,
      // Best (lowest) local-pack rank — the hydration rollup's exact value
      // (null = scanned but off the pack, or never scanned).
      serpRank: keep("serpRank")
        ? (hyd?.serp?.bestLocalPackRank ?? null)
        : undefined,
      aiSummary: keep("aiSummary")
        ? (aiSummaryById.get(b.id) ?? null)
        : undefined,
      phones,
      emails,
      socials: keep("socials") ? (socialsById.get(b.id) ?? []) : undefined,
    };
  });

  // CSV mode stops here — the export never renders touches/stats/bands/coverage.
  if (isCsv) {
    return {
      rows,
      touches: [],
      stats: {
        reachable: 0,
        enriched: 0,
        touches: 0,
        businesses: 0,
        contacted: 0,
        won: 0,
      },
      bands: {},
      coverageTypeStates: {},
      scannedAt: {},
      coverageCount: null,
    };
  }

  // ── vs-cell bands (WP6-1) · MARKET-TRUE FIRST, cohort fallback ──────────────
  // Prefer the scoring-v2 CellMetric distributions for the discovery's primary
  // cell (the whole market's percentiles — parsed once inside the hydration
  // pass) and fall back to the loaded cohort's self-distribution when the
  // aggregate is thin/absent. `match` + `tenure` have no CellMetric
  // percentile, so they're always cohort.
  const cellRef = primaryCellKey
    ? (rowData.cellRefs.get(primaryCellKey) ?? null)
    : null;
  const reference: CellReferenceBands = {
    rating: cellRef?.rating ?? null,
    reviews: cellRef?.reviewCount ?? null,
    perf: cellRef?.lighthousePerformance ?? null,
    organic: cellRef?.shareOfVoice ?? cellRef?.organicTraffic ?? null,
  };
  // Reuse evalNow (one request timestamp) rather than a second Date.now() call —
  // the React compiler flags a bare Date.now() as impure during render (INC-09).
  const tenureNow = evalNow.getTime();
  const tenureSamples = businesses
    .map((b) =>
      b.firstSeenOnGoogle
        ? Math.max(
            0,
            Math.floor(
              (tenureNow - b.firstSeenOnGoogle.getTime()) /
                (365.25 * 86_400_000),
            ),
          )
        : null,
    )
    .filter(isNum);
  const bands: Partial<Record<string, CellBand>> = resolveCellBands(
    {
      match: rows.map((r) => r.match),
      reviews: rows.map((r) => r.reviews).filter(isNum),
      rating: rows.map((r) => r.rating).filter(isNum),
      perf: rows.map((r) => r.perf).filter(isNum),
      meta_ads: businesses.map(
        (b) => rowData.metaAdCountByBusiness.get(b.id) ?? 0,
      ),
      google_ads: businesses.map(
        (b) => rowData.googleAdCountByBusiness.get(b.id) ?? 0,
      ),
      tenure: tenureSamples,
    },
    reference,
  );

  // ── Touchpoints tab read-model ──────────────────────────────────────────────
  const nameById = new Map(businesses.map((b) => [b.id, b.name]));

  const touches: WorkbenchTouch[] = drafts.map((d) => {
    const lead = leadByBusiness.get(d.businessId) ?? null;
    const { why } = parseWhyJson(d.whyJson);
    const findingPains = (painsById.get(d.businessId) ?? []).map((p) => ({
      group: p.group,
      label: p.label,
      title: p.title,
    }));
    // Merge grounding why-strings (as neutral chips) after the flagged-finding
    // pains so every drafted step shows what it leans on.
    const whyPains = why.map((w) => ({ group: "more", label: w, title: w }));
    return {
      draftId: d.id,
      businessId: d.businessId,
      businessName: nameById.get(d.businessId) ?? "Business",
      leadId: lead?.id ?? d.leadId ?? null,
      leadStatus: (lead?.status ?? "NEW") as LeadStatus,
      channel: d.channel,
      subject: d.subject,
      body: d.body,
      sent: d.status === "sent",
      pains: [...findingPains, ...whyPains].slice(0, 5),
      phones: phonesById.get(d.businessId) ?? [],
      emails: emailsById.get(d.businessId) ?? [],
    };
  });

  // ── Coverage matrix + provenance timestamps ────────────────────────────────
  // Scoped to EXACTLY the rendered window (businessIds) so the matrix aligns
  // row-for-row — never an independent re-query that drifts on page 2+. The
  // presence facts come from the SAME hydration pass the rows were built from
  // (one truth), so the shared loader skips its 9 existence scans and keeps
  // only its genuinely distinct queries (EnrichmentJob run matrix ×3, the
  // cell-scoped AdMarketRun runs, active EnrichmentRuns). The pages verified
  // discovery/list ownership BEFORE calling the builder (security.md).
  const presence = new Map<string, TypePresence>();
  for (const b of businesses) {
    const hyd = hydrated.get(b.id);
    presence.set(b.id, {
      contacts: (hyd?.contacts.totalCount ?? 0) > 0,
      services: rowData.servicePresence.has(b.id),
      tech: hyd?.tech.scanned === true,
      reviews: hyd?.reviews.hasAnyReview === true,
      metaAds: rowData.metaAdCountByBusiness.has(b.id),
      googleAds: rowData.googleAdCountByBusiness.has(b.id),
      serp: rowData.serpPresence.has(b.id),
      lighthouse: hyd?.lighthouse != null,
      aiResearch: rowData.aiPresence.has(b.id),
    });
  }
  const [matrix, scannedAt] = await Promise.all([
    loadTypeStatesForBusinesses(
      businesses.map((b) => ({ id: b.id, cellKey: b.cellKey })),
      ctx.agencyId,
      { presence },
    ),
    // AUDIT U16 · per-data-group last-scanned dates (from the billing freshness
    // cursors) for the value cells' "scanned {when}" provenance tooltip.
    loadScannedAtMap(businesses.map((b) => ({ id: b.id, cellKey: b.cellKey }))),
  ]);
  const coverageTypeStates: Record<
    string,
    Record<EnrichmentTypeKey, TypeState>
  > = {};
  for (const [id, row] of matrix) coverageTypeStates[id] = row.typeStates;

  // Stat strip — computed from the window's rows + drafts.
  const stats: TouchpointStats = {
    reachable: rows.filter((r) => r.reachable).length,
    // Same predicate as the header count — never rows.length (every rendered
    // row read "enriched" before the truth unification).
    enriched: [...matrix.values()].filter((r) =>
      anyLeadGroupRan(deriveGroupStates(r.typeStates)),
    ).length,
    touches: touches.length,
    businesses: new Set(touches.map((t) => t.businessId)).size,
    contacted: rows.filter((r) =>
      (["CONTACTED", "REPLIED", "WON", "LOST"] as LeadStatus[]).includes(
        r.status,
      ),
    ).length,
    won: rows.filter((r) => r.status === "WON").length,
  };

  return {
    rows,
    touches,
    stats,
    bands,
    coverageTypeStates,
    scannedAt,
    coverageCount: matrix.size,
  };
}

// ── Shared pure helpers (were copied character-for-character across the two
//    pages + the export route — they live ONCE here now) ──────────────────────

const SOCIAL_CHANNELS = new Set([
  "INSTAGRAM",
  "FACEBOOK",
  "TIKTOK",
  "YOUTUBE",
  "X",
  "LINKEDIN",
]);

const CONFIDENCE_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** "medical_spa|miami|US" → "Medical spa · Miami" (best-effort, no DB). */
export function prettyCell(cellKey: string | null): string {
  if (!cellKey) return "this market";
  const parsed = parseCellKey(cellKey);
  if (!parsed) return cellKey;
  const cat = parsed.categorySlug.replace(/_/g, " ");
  const metro = parsed.metroSlug.replace(/[_-]/g, " ");
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${cap(cat)} · ${cap(metro)}`;
}

/** Filesystem-safe lowercase slug for the CSV filename (WP2-4). */
export function csvSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "leads"
  );
}

/** `?page=` → a 1-based integer window index (defensive · default 1). */
export function parsePageParam(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** "3 days ago" / "today" — the header's mapped-freshness meta line. */
export function relativeDays(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/**
 * A9 (filters audit P2) · registry/finding signalKey → the curated SIG_META
 * card TITLE where one binds it, so finding-based pain chips read "Unanswered
 * 1★ reviews", not a raw prettified "unanswered_1star_count". Both the
 * `registryKey` (eval binding) and legacy `signalKey` are indexed; catalog
 * order wins when several cards share a key. Built once at module load (pure
 * over SIG_META).
 */
const TITLE_BY_SIGNAL_KEY: Record<string, string> = (() => {
  const idx: Record<string, string> = {};
  for (const meta of Object.values(SIG_META)) {
    for (const k of [meta.registryKey, meta.signalKey]) {
      if (k && !(k in idx)) idx[k] = meta.title;
    }
  }
  return idx;
})();

/** SIG_META title where a card binds the key, else "perf_savings_ms" →
 *  "Perf savings ms" (best-effort prettify fallback). */
function signalKeyLabel(key: string): string {
  const title = TITLE_BY_SIGNAL_KEY[key];
  if (title) return title;
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function isNum(v: number | null): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function rankTouch(t: TouchState): number {
  return ["None", "Draft", "Queued", "Sent", "Replied"].indexOf(t);
}
