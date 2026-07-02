/**
 * Agency Discovery WORKSPACE ·
 * `/(agency)/discover/[discoveryId]` (the leads workbench, whole-discovery scope).
 *
 * This is the surface reached by "My research → Open" and the journey's "See the
 * leads workbench" button. In the prototype it is `#view-workspace`: a dense
 * two-tab workspace (Leads · Touchpoints) over the discovery's mapped market —
 * NOT a raw-list overview. We reuse the exact Phase 4 workbench the sibling
 * `lists/[listId]` page uses (`WorkbenchShell` + `LeadsWorkbench` +
 * `TouchpointsTab` + the pure `leads-workbench` read-model); the only difference
 * is scope: a List page builds rows from `list.leads`, this page builds the SAME
 * `WorkbenchLeadRow[]` from the discovery's BUSINESSES (no List needed).
 *
 * Businesses aren't leads, so each row defaults to status NEW. Where a business
 * already has a `Lead` in one of THIS discovery's saved lists, we adopt that
 * Lead's real id + status so the status pill is wired (the optimistic mutation
 * goes through `setLeadStatusAction`). Where no Lead exists yet, the row's id
 * falls back to the business id: the pill still renders + cycles optimistically,
 * but the action finds no Lead and reverts gracefully — effectively display-only
 * until the business is saved into a list. (See the page summary.)
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 4 · no function props cross the client boundary — rows/touches/
 *     stats are plain serialized data; the client components import their own
 *     server actions.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth: no session → `unauthorized()`; session but no AgencyMember →
 * `redirect('/home')`. A discovery owned by a different agency reads as
 * not-found (`notFound()`); we never confirm another agency's data. Every query
 * is agency-scoped so a cross-agency leak is impossible
 * (`.claude/rules/security.md`). No external API in the request path.
 *
 * Copy is English-only for now (the app runs English-only — see i18n/routing.ts).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { cellFreshnessState, parseCellKey } from "@/lib/cell";
import { US_METROS } from "@/lib/geo/us-metros";
import { enrichmentNeedsWebsite } from "@/modules/cost/pricing";
import { usdToCredits } from "@/modules/cost/estimate";
import { rawListWhere } from "@/modules/discovery/raw-list";
import { researchesForSignals } from "@/modules/agency-portal/discover/researches";
import {
  resolveCellBands,
  type CellReferenceBands,
} from "@/modules/agency-portal/discover/signals";
import { parseCellReference } from "@/modules/market/cell-metrics";
import { deriveFamilyCoverage } from "@/modules/agency-portal/discover/family-coverage";
import {
  loadCoverageMatrix,
  coverageMatrixToMap,
} from "@/modules/agency-portal/discover/coverage-matrix";
import {
  WORKBENCH_WINDOW,
  resolveLeadMatch,
  painGroupClass,
  type CellBand,
  type LeadStatus,
  type TouchState,
  type WorkbenchLeadRow,
} from "@/modules/agency-portal/discover/leads-workbench";
import {
  hydrateBusinessForSignals,
  resolveMatches,
} from "@/modules/agency-portal/discover/signal-eval";
import {
  activeSignalsFromJson,
  goalMetaFromJson,
} from "@/modules/agency-portal/discover/discovery-signals";
import {
  SIG_META,
  templateByKey,
} from "@/modules/agency-portal/discover/goal-templates";
import { WorkspaceHeader } from "@/modules/agency-portal/discover/components/WorkspaceHeader";
import {
  WorkbenchShell,
  type WorkbenchShellProps,
} from "@/modules/agency-portal/discover/components/WorkbenchShell";
import { LiveWorkbenchBanner } from "@/modules/agency-portal/discover/components/LiveWorkbenchBanner";
import { resolveActiveRunForDiscovery } from "@/modules/agency-portal/discover/active-run";
import type { WorkbenchTouch } from "@/modules/agency-portal/discover/components/TouchpointsTab";
import { parseWhyJson } from "@/modules/agency-portal/discover/touchpoints";
import { draftWhereForAgency } from "@/modules/outreach/draft-scope";

export const metadata: Metadata = {
  title: "Workspace · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server fetch-window (WP4-4): the workbench fetches ONE window of
// WORKBENCH_WINDOW (1000) businesses per request, at the offset the awaited
// `?page=` searchParam selects (Pattern 3 · awaited INSIDE the Suspense
// boundary). 1000 keeps page 1 identical to the old MAX_BUSINESSES ceiling
// (same client-side sort/filter/vs-cell cohort); rows beyond it are now
// reachable — the client pager crosses window boundaries via
// router.replace("?page=N") and the full set streams from the export route.
// The single bounded query + bounded side-loads keep the scalability rule
// intact. Window-size rationale lives on WORKBENCH_WINDOW (leads-workbench.ts).

const METRO_NAME_BY_SLUG = new Map(
  US_METROS.map((m) => [m.slug.toLowerCase(), m.name] as const),
);

export default function DiscoveryWorkspacePage({
  params,
  searchParams,
}: PageProps) {
  return (
    <Suspense fallback={null}>
      <DiscoveryWorkspaceBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DiscoveryWorkspaceBody({ params, searchParams }: PageProps) {
  const { locale, discoveryId } = await params;
  setRequestLocale(locale);
  // Pattern 3 (cache-components.md): request-time searchParams are awaited
  // INSIDE the Suspense boundary, never on it.
  const requestedPage = parsePageParam((await searchParams).page);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    select: { agencyId: true },
  });
  if (!member) {
    redirect({ href: "/home", locale });
    return null;
  }
  const agencyId = member.agencyId;

  const discovery = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: {
      id: true,
      agencyId: true,
      name: true,
      cellKeys: true,
      signalsJson: true,
      spendToDateUsd: true,
      totalBusinesses: true,
      createdAt: true,
      finishedAt: true,
    },
  });

  // Cross-agency access (or missing row) reads as not-found — we never confirm
  // the existence of another agency's discovery.
  if (!discovery || discovery.agencyId !== agencyId) notFound();

  const cellKeys = discovery.cellKeys;

  // If the goal's researches need a live website (Lighthouse/contacts/tech/…),
  // website-less businesses were never enriched (the enrich scope excludes
  // them), so they'd be dead, contact-less rows in the workbench. Hide them for
  // those goals so the visible list == the enrichable list. Goals that don't
  // read the site (reviews/ads/serp only) keep every business visible.
  const activeSignals = activeSignalsFromJson(discovery.signalsJson);
  const goalNeedsWebsite = enrichmentNeedsWebsite(
    researchesForSignals(activeSignals),
  );
  const listWhere = rawListWhere({
    cellKeys,
    filters: goalNeedsWebsite ? { hasWebsite: true } : undefined,
  });

  // The whole-market count FIRST (drives the window clamp + the header
  // narrative + the honest totals). Falls back to the denormalized total when
  // there are no cells.
  const totalBusinesses =
    cellKeys.length === 0
      ? discovery.totalBusinesses
      : await prisma.business.count({ where: listWhere });

  // Server window (WP4-4): clamp the requested `?page=` into range so a stale
  // deep link past the end lands on the last window, never an empty table.
  const serverPageCount =
    cellKeys.length === 0
      ? 1
      : Math.max(1, Math.ceil(totalBusinesses / WORKBENCH_WINDOW));
  const serverPage = Math.min(requestedPage, serverPageCount);

  // The discovery's businesses (the same hidden/closed gate as the raw list, so
  // the workbench shows the same default market). Ordered like getRawList
  // (reviewCount desc NULLS LAST, id asc) so the strongest leads lead — Postgres
  // sinks NULL review counts (see modules/discovery/raw-list.ts). One window of
  // WORKBENCH_WINDOW rows at the ?page offset (stable order + id tiebreaker
  // keeps skip/take windows non-overlapping).
  const businesses =
    cellKeys.length === 0
      ? []
      : await prisma.business.findMany({
          where: listWhere,
          orderBy: [
            { reviewCount: { sort: "desc", nulls: "last" } },
            { id: "asc" },
          ],
          skip: (serverPage - 1) * WORKBENCH_WINDOW,
          take: WORKBENCH_WINDOW,
          select: {
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
            // WP6-1 · tenure cohort sample (years-on-Google) for the vs-cell
            // "tenure" band — CellMetric carries no tenure percentile, so this
            // band is cohort-sourced (honest within the Discovery).
            firstSeenOnGoogle: true,
          },
        });

  const businessIds = businesses.map((b) => b.id);

  // Parallel side loads (all scoped to this discovery's businesses):
  //   - existing Leads in THIS discovery's saved lists → real leadId + status
  //   - latest snapshot / Lighthouse audit per business (vs-cell + perf proxy)
  //   - flagged PlaybookFindings (pain chips + match derivation + "why")
  //   - CMS tech (built-on)
  //   - contacts (phones / emails + reachable)
  //   - OutreachDrafts (the Touchpoints tab + per-lead touch state)
  const [
    existingLeads,
    snapshots,
    audits,
    findings,
    techs,
    contacts,
    drafts,
    ads,
    serps,
  ] =
    businessIds.length === 0
      ? [[], [], [], [], [], [], [], [], []]
      : await Promise.all([
          prisma.lead.findMany({
            where: {
              agencyId,
              businessId: { in: businessIds },
              list: { discoveryId: discovery.id },
            },
            orderBy: { statusChangedAt: "desc" },
            select: {
              id: true,
              businessId: true,
              status: true,
              contactedAt: true,
            },
          }),
          prisma.businessSnapshot.findMany({
            where: { businessId: { in: businessIds } },
            orderBy: { snapshotDate: "desc" },
            select: {
              businessId: true,
              reviewCount: true,
              rating: true,
              snapshotDate: true,
            },
          }),
          prisma.lighthouseAudit.findMany({
            where: { businessId: { in: businessIds } },
            orderBy: { auditedAt: "desc" },
            select: { businessId: true, performance: true, auditedAt: true },
          }),
          prisma.playbookFinding.findMany({
            where: { businessId: { in: businessIds }, status: "flagged" },
            orderBy: { confidence: "asc" },
            select: {
              businessId: true,
              signalKey: true,
              group: true,
              confidence: true,
              explanation: true,
              pitchAngle: true,
            },
          }),
          prisma.businessTech.findMany({
            where: { businessId: { in: businessIds }, category: "CMS" },
            orderBy: { confidence: "desc" },
            select: { businessId: true, name: true },
          }),
          prisma.contact.findMany({
            where: { businessId: { in: businessIds } },
            select: { businessId: true, channel: true, value: true },
          }),
          prisma.outreachDraft.findMany({
            // WP0-1/WP5 · agency-scope draft reads (draftWhereForAgency) so a
            // competing agency in the same shared market cell can't read this
            // agency's outreach copy. Legacy null-agencyId rows stay visible via
            // the helper's OR-null arm until the backfill script resolves them.
            where: draftWhereForAgency(agencyId, businessIds),
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
          }),
          // Ads + Search presence — the SAME real rows the lead drawer reads
          // (adsEnriched = ads.length > 0 · serpEnriched = serp != null). These
          // feed the coverage map so the table no longer fakes ads/search as
          // never-covered. Existence-only (distinct businessId).
          // WP6-1 · Meta-ad COUNT per business (groupBy) — feeds both the
          // ads-presence set (count > 0) AND the vs-cell "ads" cohort band.
          prisma.adLibraryEntry.groupBy({
            by: ["businessId"],
            where: { businessId: { in: businessIds }, platform: "META" },
            _count: { _all: true },
          }),
          prisma.serpResult.findMany({
            where: { businessId: { in: businessIds } },
            select: { businessId: true },
            distinct: ["businessId"],
          }),
        ]);

  // Ads / Search presence sets (one membership test per business below).
  // WP6-1 · adsCountByBusiness carries the Meta-ad creative count per business
  // (the "ads" band sample); the presence set is derived from it (count > 0).
  const adsCountByBusiness = new Map(
    ads.map((r) => [r.businessId, r._count._all]),
  );
  const adsByBusiness = new Set(adsCountByBusiness.keys());
  const serpByBusiness = new Set(serps.map((r) => r.businessId));

  // ── Real signal evaluation (P3) ────────────────────────────────────────────
  // The research's persisted signals → ActiveSignal[] via SIG_META. When present,
  // we hydrate every business ONCE (batched, read-only, snapshots only) and
  // resolveMatches per lead for a REAL match% + per-signal verdicts — replacing
  // the pain-count heuristic. signalsJson absent / no active signals → empty
  // ActiveSignal[] → the per-row fallback keeps deriveMatchPct (nothing breaks).
  // `activeSignals` is computed once, above (also drives the website filter).
  const hydrated =
    activeSignals.length > 0 && businessIds.length > 0
      ? await hydrateBusinessForSignals(businessIds)
      : null;
  const evalNow = new Date();
  // The goal's active signals (key + title) — the workbench renders one
  // column per signal (docs/portal-prototype.html's goalCols/makeSigCol) so
  // what you searched for on the Goal step is directly answered per lead. We
  // never auto-FILTER by them (a signal still mid-enrichment would otherwise
  // silently hide real leads) — only the column is signal-driven, not the
  // row set.
  const goalSignals = activeSignals
    .map((s) => {
      const title = SIG_META[s.key]?.title;
      return title ? { key: s.key, title } : null;
    })
    .filter((s): s is { key: string; title: string } => s !== null);

  // First (=latest) row per business for the "latest snapshot/audit" pattern.
  const latestSnapshot = firstByBusiness(snapshots);
  const latestAudit = firstByBusiness(audits);

  // Existing Lead per business (most-recently-changed wins) → real id + status.
  const leadByBusiness = new Map<
    string,
    { id: string; status: LeadStatus; contactedAt: Date | null }
  >();
  for (const l of existingLeads) {
    if (!leadByBusiness.has(l.businessId)) {
      leadByBusiness.set(l.businessId, {
        id: l.id,
        status: l.status as LeadStatus,
        contactedAt: l.contactedAt,
      });
    }
  }

  // CMS built-on (highest-confidence first row wins).
  const builtOnById = new Map<string, string>();
  for (const t of techs)
    if (!builtOnById.has(t.businessId)) builtOnById.set(t.businessId, t.name);

  // Contacts → phones / emails per business.
  const phonesById = new Map<string, string[]>();
  const emailsById = new Map<string, string[]>();
  for (const c of contacts) {
    if (c.channel === "PHONE" || c.channel === "WHATSAPP") {
      push(phonesById, c.businessId, c.value);
    } else if (c.channel === "EMAIL") {
      push(emailsById, c.businessId, c.value);
    }
  }

  // Flagged findings → pain chips per business (most-confident first).
  // `confidence` is a string rank ('high'|'medium'|'low'); a DB orderBy on it
  // sorts alphabetically (high < low < medium — wrong), so rank in JS instead
  // (WP2-4 fix). Highest confidence first → first-wins pitch/pains are strongest.
  const CONFIDENCE_RANK: Record<string, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };
  const rankedFindings = [...findings].sort(
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

  // ── Build the workbench rows (one per business) ────────────────────────────
  const rows: WorkbenchLeadRow[] = businesses.map((b) => {
    const snap = latestSnapshot.get(b.id);
    const audit = latestAudit.get(b.id);
    const reviews = snap?.reviewCount ?? b.reviewCount ?? null;
    const rating = snap?.rating ?? b.rating ?? null;
    const perf = audit?.performance ?? null;
    const phones = phonesById.get(b.id) ?? (b.phone ? [b.phone] : []);
    const emails = emailsById.get(b.id) ?? (b.email ? [b.email] : []);
    const pains = painsById.get(b.id) ?? [];
    const cell = prettyCell(b.cellKey);
    const lead = leadByBusiness.get(b.id) ?? null;
    // REAL signal eval when the research persisted signals; else (no signals /
    // not-computable) fall back to the pain-count heuristic. No stored
    // Lead.matchScore at the discovery scope.
    const evalResult =
      hydrated && hydrated.get(b.id)
        ? resolveMatches(activeSignals, hydrated.get(b.id)!, evalNow)
        : null;
    const { match, matchFromSignals, matchDerived, perSignal } =
      resolveLeadMatch(evalResult, null, pains.length);

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
      pains: pains.map((p) => ({ ...p, group: painGroupClass(p.group) })),
      reachability: b.reachability,
      reachable:
        (b.reachableChannelCount ?? 0) > 0 ||
        phones.length > 0 ||
        emails.length > 0,
      builtOn: builtOnById.get(b.id) ?? null,
      website: b.website ?? null,
      pitchAngle: pitchById.get(b.id) ?? null,
      touch: touchByBusiness.get(b.id) ?? "None",
      lastContactedAt: lead?.contactedAt?.toISOString() ?? null,
      reviews,
      rating,
      perf,
      phones,
      emails,
      // All six families derived from the SAME real data the drawer uses — no
      // hardcoded ads/search negatives. deriveFamilyCoverage is the single
      // source of truth shared with the drawer + the coverage endpoint.
      families: deriveFamilyCoverage({
        reviews: reviews != null,
        website: perf != null || builtOnById.has(b.id),
        contacts: phones.length > 0 || emails.length > 0,
        ads: adsByBusiness.has(b.id),
        search: serpByBusiness.has(b.id),
      }),
    };
  });

  // ── vs-cell bands (WP6-1) ───────────────────────────────────────────────────
  // MARKET-TRUE FIRST, cohort fallback: prefer the scoring-v2 CellMetric
  // distributions for this discovery's primary cell (the whole market's
  // percentiles, stable across every Discovery of that cell) and only fall back
  // to the loaded cohort's self-distribution when the aggregate is thin/absent.
  // `match` + `tenure` have no CellMetric percentile, so they're always cohort.
  const primaryCellKey = cellKeys[0] ?? null;
  const cellMetric = primaryCellKey
    ? await prisma.cellMetric.findFirst({
        where: { cellKey: primaryCellKey },
        orderBy: { computedAt: "desc" },
        select: {
          sampleSize: true,
          confidence: true,
          adPrevalence: true,
          distributions: true,
        },
      })
    : null;
  const cellRef = parseCellReference(cellMetric);
  // Map the CellReference breakpoints onto the workbench band keys. shareOfVoice
  // is the organic-traffic proxy; a cell that never aggregated a band leaves it
  // undefined → resolveCellBands takes the cohort path for it.
  const reference: CellReferenceBands = {
    rating: cellRef?.rating ?? null,
    reviews: cellRef?.reviewCount ?? null,
    perf: cellRef?.lighthousePerformance ?? null,
    organic: cellRef?.shareOfVoice ?? cellRef?.organicTraffic ?? null,
  };
  // Cohort samples for the fallback path + the bands CellMetric can't carry.
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
  const adsSamples = businesses.map((b) => adsCountByBusiness.get(b.id) ?? 0);
  const bands: Partial<Record<string, CellBand>> = resolveCellBands(
    {
      match: rows.map((r) => r.match),
      reviews: rows.map((r) => r.reviews).filter(isNum),
      rating: rows.map((r) => r.rating).filter(isNum),
      perf: rows.map((r) => r.perf).filter(isNum),
      ads: adsSamples,
      tenure: tenureSamples,
    },
    reference,
  );

  // ── Touchpoints tab read-model ─────────────────────────────────────────────
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

  // Stat strip — computed from the discovery's businesses + drafts.
  const stats = {
    reachable: rows.filter((r) => r.reachable).length,
    enriched: rows.length,
    touches: touches.length,
    businesses: new Set(touches.map((t) => t.businessId)).size,
    contacted: rows.filter((r) =>
      (["CONTACTED", "REPLIED", "WON", "LOST"] as LeadStatus[]).includes(
        r.status,
      ),
    ).length,
    won: rows.filter((r) => r.status === "WON").length,
  };

  // ── Coverage matrix (the doc's batched GET /research/:id/coverage) ─────────
  // Fetched server-side via the SHARED loader the endpoint also uses, then
  // passed to the client workbench as a PLAIN `{ businessId: families[] }` map
  // (Pattern 4 — no functions cross the boundary). Drives the per-row dot-strip.
  // Same rawListWhere + ordering as the rows above, so it aligns row-for-row.
  const coverageRows = await loadCoverageMatrix(discovery.id, agencyId);
  const coverage = coverageRows ? coverageMatrixToMap(coverageRows) : {};

  // WP4-1 · is an enrichment run still working this discovery's leads? If so
  // (or if one just closed within 60s) the live banner polls the WP3-3 progress
  // endpoint + router.refresh()es new rows in as they enrich. Resolved by
  // cellKey overlap (no discoveryId FK on EnrichmentRun — same as the directory).
  const activeRun = await resolveActiveRunForDiscovery(agencyId, cellKeys);

  // CSV export filename base: "{categorySlug}-{metroSlug}" from the first
  // cell (WP2-4) — the client appends the date. Fallback handled client-side.
  const firstCellForSlug = cellKeys[0] ? parseCellKey(cellKeys[0]) : null;
  const exportSlug = firstCellForSlug
    ? `${csvSlug(firstCellForSlug.categorySlug)}-${csvSlug(firstCellForSlug.metroSlug)}`
    : undefined;

  const shell: WorkbenchShellProps = {
    leads: {
      rows,
      discoveryId,
      bands,
      coverage,
      goalSignals,
      exportSlug,
      serverPage,
      serverPageCount,
      totalRows: totalBusinesses,
      // Streams the FULL set (WP4-4) — same 13 columns via rowToCsvRecord.
      exportAllUrl: `/api/agency/research/${discoveryId}/export`,
    },
    touchpoints: { touches, stats },
  };

  // ── Header: "{Category} · {Metro}" from the first cell ──────────────────────
  const firstCell = cellKeys[0] ? parseCellKey(cellKeys[0]) : null;
  const categoryLabel = firstCell
    ? await resolveCategoryLabel(firstCell.categorySlug)
    : null;
  const metroLabel = firstCell ? resolveMetroLabel(firstCell.metroSlug) : null;
  const title =
    categoryLabel && metroLabel
      ? `${categoryLabel} · ${metroLabel}`
      : (discovery.name ?? "Workspace");

  // The research goal for the header pill (WP4-14): the persisted goal name,
  // else the base template's title, else no pill (older discoveries).
  const goalMeta = goalMetaFromJson(discovery.signalsJson);
  const goalName =
    goalMeta.goalName ??
    (goalMeta.goalBase
      ? (templateByKey(goalMeta.goalBase)?.title ?? null)
      : null);

  // Meta line: mapped freshness + spend-to-date credits.
  const mappedAt = discovery.finishedAt ?? discovery.createdAt;
  const now = new Date();
  const freshness = cellFreshnessState(mappedAt, now);
  const credits = usdToCredits(discovery.spendToDateUsd);

  return (
    <div className="view full">
      {/* WP4-14 · goal pill + market narrative lead; the count reads as
          context ("the 412 med spas in this market · showing 200"), never a
          truncation warning. */}
      <WorkspaceHeader
        title={title}
        goalName={goalName}
        showing={rows.length}
        total={totalBusinesses}
        marketNoun={marketNoun(categoryLabel)}
        freshness={freshness}
        mappedRelative={relativeDays(mappedAt)}
        credits={credits}
      />

      {activeRun ? (
        <LiveWorkbenchBanner
          runId={activeRun.runId}
          initialStatus={activeRun.status}
        >
          <WorkbenchShell {...shell} />
        </LiveWorkbenchBanner>
      ) : (
        <WorkbenchShell {...shell} />
      )}
    </div>
  );
}

// ── Server-side helpers (pure shaping) ───────────────────────────────────────

/** "medical_spa|miami|US" → "Medical spa · Miami" (best-effort, no DB). */
function prettyCell(cellKey: string | null): string {
  if (!cellKey) return "this market";
  const parsed = parseCellKey(cellKey);
  if (!parsed) return cellKey;
  const cat = parsed.categorySlug.replace(/_/g, " ");
  const metro = parsed.metroSlug.replace(/[_-]/g, " ");
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${cap(cat)} · ${cap(metro)}`;
}

/** Resolve a category slug → human label from BusinessCategory (else slug). */
async function resolveCategoryLabel(slug: string): Promise<string> {
  const cat = await prisma.businessCategory.findUnique({
    where: { dataforseoId: slug },
    select: { label: true },
  });
  return cat?.label ?? titleCaseSlug(slug);
}

/** Resolve a metro slug → "Miami" (drops the trailing state for the header). */
function resolveMetroLabel(slug: string): string {
  const name = METRO_NAME_BY_SLUG.get(slug.toLowerCase());
  return (name ?? titleCaseSlug(slug)).split(",")[0].trim();
}

/** Filesystem-safe lowercase slug for the CSV filename (WP2-4). */
function csvSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "leads"
  );
}

/** "medical_spa" → "Medical Spa" — slug fallback when no DB label is found. */
function titleCaseSlug(slug: string): string {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** `?page=` → a 1-based integer window index (defensive · default 1). */
function parsePageParam(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * "Medical spa" → "medical spas" — the header narrative's plural market noun
 * (best-effort naive plural; category labels are simple nouns). Falls back to
 * "businesses" when no category label resolved.
 */
function marketNoun(categoryLabel: string | null): string {
  if (!categoryLabel) return "businesses";
  const lower = categoryLabel.toLowerCase();
  return lower.endsWith("s") ? lower : `${lower}s`;
}

function firstByBusiness<T extends { businessId: string }>(
  rows: T[],
): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) if (!m.has(r.businessId)) m.set(r.businessId, r);
  return m;
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

/** "perf_savings_ms" → "Perf savings ms" (best-effort signal-key label). */
function signalKeyLabel(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function relativeDays(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
