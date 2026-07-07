/**
 * Agency leads WORKBENCH ·
 * `/(agency)/discover/[discoveryId]/lists/[listId]` (the heart of the portal).
 *
 * A saved list opened as a two-tab workspace (Leads · Touchpoints) sharing one
 * set of Lead rows. The Leads tab is a dense power table (search · group-by-cell
 * · Comfortable/Compact density · vs-cell deltas · Fields menu · filter chips ·
 * coverage line · sortable cols · numbered pagination · bulk bar). The
 * Touchpoints tab groups the generated OutreachDrafts by business into expandable
 * grounded sequences. Built on the ported prototype classes (agency-portal.css)
 * + the adopted agency primitives (StatusPill, BulkActionBar).
 *
 * Match % comes from `Lead.matchScore` when stored, else is DERIVED from the
 * count of flagged PlaybookFindings (see deriveMatchPct). Pain-point chips and
 * "why this works" come from flagged PlaybookFindings grouped by signal group.
 * vs-cell bands are computed from the list's own cohort distribution.
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
 * `redirect('/home')`. A list owned by a different agency — or one whose
 * discoveryId doesn't match the route — reads as not-found (`notFound()`); we
 * never confirm another agency's data. Every query is scoped by agencyId so a
 * cross-agency leak is impossible (`.claude/rules/security.md`).
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
import { cellBand } from "@/modules/agency-portal/discover/signals";
import {
  anyLeadGroupRan,
  deriveGroupStates,
} from "@/modules/agency-portal/discover/family-coverage";
import {
  loadCoverageMatrix,
  coverageTypeStatesToMap,
  loadScannedAtMap,
} from "@/modules/agency-portal/discover/coverage-matrix";
import {
  WORKBENCH_WINDOW,
  resolveLeadMatch,
  mergeSignalVerdicts,
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
  allLibraryActiveSignals,
  allLibrarySignals,
  goalMetaFromJson,
} from "@/modules/agency-portal/discover/discovery-signals";
import {
  SIG_META,
  templateByKey,
} from "@/modules/agency-portal/discover/goal-templates";
import { researchesForSignals } from "@/modules/agency-portal/discover/researches";
import { WorkspaceHeader } from "@/modules/agency-portal/discover/components/WorkspaceHeader";
import {
  WorkbenchShell,
  type WorkbenchShellProps,
} from "@/modules/agency-portal/discover/components/WorkbenchShell";
import { LiveRunGate } from "@/modules/agency-portal/discover/components/LiveRunGate";
import {
  resolveActiveRunForDiscovery,
  resolveSpendCreditsForDiscovery,
} from "@/modules/agency-portal/discover/active-run";
import type { WorkbenchTouch } from "@/modules/agency-portal/discover/components/TouchpointsTab";
import { parseWhyJson } from "@/modules/agency-portal/discover/touchpoints";
import { draftWhereForAgency } from "@/modules/outreach/draft-scope";

export const metadata: Metadata = {
  title: "Workbench · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string; listId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server fetch-window (WP4-4): ONE window of WORKBENCH_WINDOW (1000) leads per
// request, at the offset the awaited `?page=` searchParam selects (Pattern 3 ·
// awaited INSIDE the Suspense boundary). Page 1 is identical to the old
// MAX_LEADS ceiling; every lead beyond it is now reachable via the pager's
// window crossing (+ the server export route streams the full set). See
// WORKBENCH_WINDOW (leads-workbench.ts) for the window-size rationale.

// The whole curated signal library as ActiveSignal[] (default thresholds) +
// its {key,title} option list — built ONCE (pure over SIG_META). Every lead is
// evaluated against ALL_LIB_SIGNALS so any signal with data on the full cohort
// is filterable (#2); LIBRARY_OPTIONS is the "+ Signal" picker's option list.
const ALL_LIB_SIGNALS = allLibraryActiveSignals();
const LIBRARY_OPTIONS = allLibrarySignals();

export default function ListWorkbenchPage({ params, searchParams }: PageProps) {
  return (
    <Suspense fallback={null}>
      <ListWorkbenchBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** "medical_spa · miami" → "Medical spa · Miami" (best-effort, no DB). */
function prettyCell(cellKey: string | null): string {
  if (!cellKey) return "this market";
  const parsed = parseCellKey(cellKey);
  if (!parsed) return cellKey;
  const cat = parsed.categorySlug.replace(/_/g, " ");
  const metro = parsed.metroSlug.replace(/_/g, " ");
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${cap(cat)} · ${cap(metro)}`;
}

async function ListWorkbenchBody({ params, searchParams }: PageProps) {
  const { locale, discoveryId, listId } = await params;
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

  // Load the list meta + total lead count first (WP4-4 — the count drives the
  // window clamp + the header totals). Scoped by listId; agency ownership is
  // checked immediately after.
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: {
      id: true,
      agencyId: true,
      name: true,
      discoveryId: true,
      serviceType: true,
      metro: true,
      category: true,
      lastRefreshedAt: true,
      _count: { select: { leads: true } },
    },
  });

  // Cross-agency, missing, or a list that doesn't belong to this discovery all
  // read as not-found — we never confirm another agency's data.
  if (!list || list.agencyId !== agencyId || list.discoveryId !== discoveryId) {
    notFound();
  }

  // Server window (WP4-4): clamp the requested `?page=` into range, then fetch
  // ONE window of leads. The `id` tiebreaker keeps skip/take windows
  // non-overlapping when createdAt collides (bulk-saved lists).
  const totalLeads = list._count.leads;
  const serverPageCount = Math.max(1, Math.ceil(totalLeads / WORKBENCH_WINDOW));
  const serverPage = Math.min(requestedPage, serverPageCount);

  const leads = await prisma.lead.findMany({
    where: { listId: list.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: (serverPage - 1) * WORKBENCH_WINDOW,
    take: WORKBENCH_WINDOW,
    select: {
      id: true,
      status: true,
      matchScore: true,
      contactedAt: true,
      business: {
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
          // Closed-on-Google flags → the row's "Closed" tag on the Business
          // cell (Tom must never burn a touch on a closed business).
          permanentlyClosed: true,
          temporarilyClosed: true,
        },
      },
    },
  });

  const businessIds = leads.map((l) => l.business.id);

  // ── Real signal evaluation (P3) ────────────────────────────────────────────
  // The list belongs to a discovery; that discovery's persisted signals are the
  // research's chosen set. Build ActiveSignal[] via SIG_META, hydrate this list's
  // businesses ONCE (batched, read-only), and resolveMatches per lead for a REAL
  // match% + per-signal verdicts. signalsJson absent / no signals → empty
  // ActiveSignal[] → the per-row fallback keeps the stored-score/heuristic path.
  const discoveryRow = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: {
      signalsJson: true,
      cellKeys: true,
      finishedAt: true,
      createdAt: true,
    },
  });
  const activeSignals = activeSignalsFromJson(discoveryRow?.signalsJson);
  // Hydrate whenever there ARE leads (not only when the goal has signals) so the
  // whole-library filters (#2) work even for a signal-less/legacy goal.
  const hydrated =
    businessIds.length > 0
      ? await hydrateBusinessForSignals(businessIds)
      : null;
  const evalNow = new Date();
  // The goal's active signals (key + title) — drives the per-signal verdict
  // columns (see the discoveryId workspace page for the full rationale).
  const goalSignals = activeSignals
    .map((s) => {
      const title = SIG_META[s.key]?.title;
      return title ? { key: s.key, title } : null;
    })
    .filter((s): s is { key: string; title: string } => s !== null);
  const goalKeySet = new Set(goalSignals.map((s) => s.key));
  // WB-COL-1 · goal's research families → default the goal's data columns on.
  const goalResearches = researchesForSignals(activeSignals);

  // Parallel side loads (all scoped to this list's businesses):
  //   - latest snapshot per business (reviewCount / rating / website pillar →
  //     used for vs-cell + perf proxy)
  //   - latest Lighthouse audit per business (perf)
  //   - flagged PlaybookFindings (pain chips + match derivation + "why")
  //   - CMS tech (built-on)
  //   - contacts (phones / emails for the contact columns + reachable count)
  //   - OutreachDrafts (the Touchpoints tab + per-lead touch state)
  const [snapshots, audits, findings, techs, contacts, drafts, ads, serps] =
    businessIds.length === 0
      ? [[], [], [], [], [], [], [], []]
      : await Promise.all([
          prisma.businessSnapshot.findMany({
            where: { businessId: { in: businessIds } },
            orderBy: { snapshotDate: "desc" },
            select: {
              businessId: true,
              reviewCount: true,
              rating: true,
              websitePillar: true,
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
            // WP0-1/WP5 · agency-scoped draft read (see the discovery workspace
            // page) — no cross-tenant read of outreach copy in shared cells.
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
          // (adsEnriched = ads.length > 0 · serpEnriched = serp != null). Feeds
          // the coverage map so the table no longer fakes ads/search negatives.
          prisma.adLibraryEntry.findMany({
            where: { businessId: { in: businessIds } },
            select: { businessId: true },
            distinct: ["businessId"],
          }),
          prisma.serpResult.findMany({
            where: { businessId: { in: businessIds } },
            select: { businessId: true },
            distinct: ["businessId"],
          }),
        ]);

  // Ads / Search presence sets (one membership test per business below).
  const adsByBusiness = new Set(ads.map((r) => r.businessId));
  const serpByBusiness = new Set(serps.map((r) => r.businessId));

  // First (=latest) row per business for the "latest snapshot/audit" pattern.
  const latestSnapshot = firstByBusiness(snapshots);
  const latestAudit = firstByBusiness(audits);

  // CMS built-on (highest-confidence first row wins).
  const builtOnById = new Map<string, string>();
  for (const t of techs)
    if (!builtOnById.has(t.businessId)) builtOnById.set(t.businessId, t.name);

  // Contacts → phones / emails / socials per business (AUDIT E6).
  const SOCIAL_CHANNELS = new Set([
    "INSTAGRAM",
    "FACEBOOK",
    "TIKTOK",
    "YOUTUBE",
    "X",
    "LINKEDIN",
  ]);
  const phonesById = new Map<string, string[]>();
  const emailsById = new Map<string, string[]>();
  const socialsById = new Map<string, { channel: string; value: string }[]>();
  for (const c of contacts) {
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
  // `confidence` is a string rank; a DB orderBy sorts it alphabetically
  // (high < low < medium — wrong), so rank in JS instead (WP2-4 fix).
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

  // Touch state per lead (the most-advanced draft status drives the pill).
  const touchByBusiness = new Map<string, TouchState>();
  for (const d of drafts) {
    const t: TouchState = d.status === "sent" ? "Sent" : "Draft";
    const cur = touchByBusiness.get(d.businessId);
    if (!cur || rankTouch(t) > rankTouch(cur))
      touchByBusiness.set(d.businessId, t);
  }

  // ── Build the workbench rows ───────────────────────────────────────────────
  const rows: WorkbenchLeadRow[] = leads.map((lead) => {
    const b = lead.business;
    const snap = latestSnapshot.get(b.id);
    const audit = latestAudit.get(b.id);
    const reviews = snap?.reviewCount ?? b.reviewCount ?? null;
    const rating = snap?.rating ?? b.rating ?? null;
    const perf = audit?.performance ?? null;
    const phones = phonesById.get(b.id) ?? (b.phone ? [b.phone] : []);
    const emails = emailsById.get(b.id) ?? (b.email ? [b.email] : []);
    const pains = painsById.get(b.id) ?? [];
    const cell = prettyCell(b.cellKey);
    // REAL signal eval when the discovery persisted signals; else fall back to
    // the stored Lead.matchScore (when present) or the pain-count heuristic.
    const hyd = hydrated?.get(b.id) ?? null;
    const evalResult =
      hyd && activeSignals.length > 0
        ? resolveMatches(activeSignals, hyd, evalNow)
        : null;
    const {
      match,
      matchFromSignals,
      matchDerived,
      perSignal: goalPerSignal,
    } = resolveLeadMatch(evalResult, lead.matchScore, pains.length);
    // #2 · library verdicts (default thresholds) so any signal with data on the
    // whole cohort is filterable; goal (tuned) verdicts win + are always kept.
    const libPerSignal = hyd
      ? resolveMatches(ALL_LIB_SIGNALS, hyd, evalNow).perSignal
      : {};
    const perSignal = mergeSignalVerdicts(
      libPerSignal,
      goalPerSignal,
      goalKeySet,
    );

    return {
      leadId: lead.id,
      businessId: b.id,
      name: b.name,
      addr: [b.address ?? b.city ?? "", cell].filter(Boolean).join(" · "),
      cell,
      status: lead.status as LeadStatus,
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
      bookingTool: null,
      website: b.website ?? null,
      pitchAngle: pitchById.get(b.id) ?? null,
      touch: touchByBusiness.get(b.id) ?? "None",
      lastContactedAt: lead.contactedAt?.toISOString() ?? null,
      closed: b.permanentlyClosed
        ? ("permanent" as const)
        : b.temporarilyClosed
          ? ("temporary" as const)
          : null,
      reviews,
      rating,
      perf,
      // SEO/ad-count/AI-summary columns aren't hydrated on the list-detail
      // surface (they're off by default; the market workbench carries them) —
      // null keeps the shared row type satisfied without an extra query here.
      seo: null,
      metaAdCount: null,
      googleAdCount: null,
      serpRank: null,
      aiSummary: null,
      phones,
      emails,
      socials: socialsById.get(b.id) ?? [],
    };
  });

  // ── vs-cell bands (computed from this list's own cohort) ───────────────────
  const bands: Partial<Record<string, CellBand>> = {
    match: cellBand(rows.map((r) => r.match)) ?? undefined,
    reviews: cellBand(rows.map((r) => r.reviews).filter(isNum)) ?? undefined,
    rating: cellBand(rows.map((r) => r.rating).filter(isNum)) ?? undefined,
    perf: cellBand(rows.map((r) => r.perf).filter(isNum)) ?? undefined,
  };

  // ── Touchpoints tab read-model ─────────────────────────────────────────────
  const leadByBusiness = new Map(
    leads.map((l) => [
      l.business.id,
      { id: l.id, status: l.status as LeadStatus },
    ]),
  );
  const nameById = new Map(leads.map((l) => [l.business.id, l.business.name]));

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

  // Stat strip — computed from the list's leads + drafts (agency-scoped already).
  // Coverage matrix (the doc's batched GET /research/:id/coverage) — fetched
  // server-side via the SHARED loader the endpoint uses, passed to the client as
  // a PLAIN `{ businessId: families[] }` map (Pattern 4). Scoped to THIS list's
  // exact lead businessIds — a curated list is an arbitrary subset that need not
  // sit in the discovery's top-N, so an unscoped matrix would miss those rows
  // and drop them to the legacy presence model.
  const coverageRows = await loadCoverageMatrix(
    discoveryId,
    agencyId,
    businessIds,
  );
  // AUDIT A2 · the per-TYPE state map (9 billed types) — THE atom every
  // workbench surface derives from (the 7-group roll-up happens client-side).
  const coverageTypeStates = coverageRows
    ? coverageTypeStatesToMap(coverageRows)
    : {};
  // AUDIT U16 · per-data-group last-scanned dates for the value cells' provenance tip.
  const scannedAt = await loadScannedAtMap(
    leads.map((l) => ({ id: l.business.id, cellKey: l.business.cellKey })),
  );

  const stats = {
    reachable: rows.filter((r) => r.reachable).length,
    enriched: coverageRows
      ? coverageRows.filter((r) =>
          anyLeadGroupRan(deriveGroupStates(r.typeStates)),
        ).length
      : 0,
    touches: touches.length,
    businesses: new Set(touches.map((t) => t.businessId)).size,
    contacted: rows.filter((r) =>
      (["CONTACTED", "REPLIED", "WON", "LOST"] as LeadStatus[]).includes(
        r.status,
      ),
    ).length,
    won: rows.filter((r) => r.status === "WON").length,
  };

  // WP4-1 · live workbench — poll + refresh new rows while an enrichment run for
  // this discovery is in flight (resolved by cellKey overlap; see active-run.ts).
  const activeRun = await resolveActiveRunForDiscovery(
    agencyId,
    discoveryId,
    discoveryRow?.cellKeys ?? [],
  );

  // CSV export filename base: "{categorySlug}-{metroSlug}" from the first
  // lead's cell (WP2-4) — the client appends the date; falls back to the
  // list's own category/metro strings, then to the client default.
  const firstLeadCell = leads[0]?.business.cellKey
    ? parseCellKey(leads[0].business.cellKey)
    : null;
  const exportSlug = firstLeadCell
    ? `${csvSlug(firstLeadCell.categorySlug)}-${csvSlug(firstLeadCell.metroSlug)}`
    : list.category && list.metro
      ? `${csvSlug(list.category)}-${csvSlug(list.metro)}`
      : undefined;

  const shell: WorkbenchShellProps = {
    leads: {
      rows,
      discoveryId,
      bands,
      coverageTypeStates,
      scannedAt,
      goalSignals,
      goalResearches,
      // #2 · the full curated library for the "+ Signal" picker (gated to those
      // with data on every lead, client-side).
      allSignals: LIBRARY_OPTIONS,
      exportSlug,
      serverPage,
      serverPageCount,
      totalRows: totalLeads,
      // Streams THIS list's full set (WP4-4) — same 13 columns, scoped by
      // ?list= inside the discovery export route.
      exportAllUrl: `/api/agency/research/${discoveryId}/export?list=${listId}`,
    },
    touchpoints: { touches, stats },
  };

  const cellKey = leads[0]?.business.cellKey ?? null;
  const title = cellKey ? prettyCell(cellKey) : list.name;

  // The research goal for the header pill (WP4-14): the persisted goal name,
  // else the base template's title, else no pill (older discoveries).
  const goalMeta = goalMetaFromJson(discoveryRow?.signalsJson);
  const goalName =
    goalMeta.goalName ??
    (goalMeta.goalBase
      ? (templateByKey(goalMeta.goalBase)?.title ?? null)
      : null);

  // Meta line: mapped freshness (list refresh, else the parent research's
  // mapped date) + the research's spend-to-date credits.
  const now = new Date();
  const mappedAt =
    list.lastRefreshedAt ??
    discoveryRow?.finishedAt ??
    discoveryRow?.createdAt ??
    null;
  const freshness = mappedAt ? cellFreshnessState(mappedAt, now) : "never";
  const credits = discoveryRow?.cellKeys?.length
    ? await resolveSpendCreditsForDiscovery(
        agencyId,
        discoveryId,
        discoveryRow.cellKeys,
      )
    : 0;

  return (
    <div className="view full">
      {/* WP4-14 · shared workspace header — goal pill + narrative count
          ("the 1,412 leads in this list · showing 1,000"), list name +
          service kept as the trailing meta segment. Back-nav stays on the
          parent research workspace. */}
      <WorkspaceHeader
        title={title}
        goalName={goalName}
        showing={rows.length}
        total={totalLeads}
        marketNoun="leads"
        scopeNoun="list"
        freshness={freshness}
        mappedRelative={mappedAt ? relativeDays(mappedAt) : "—"}
        credits={credits}
        backHref={{
          pathname: "/discover/[discoveryId]",
          params: { discoveryId },
        }}
        extra={`${list.name} · ${list.serviceType.toLowerCase().replace(/_/g, " ")}`}
      />

      {/* AUDIT D4 · always-mounted gate (see LiveRunGate). */}
      <LiveRunGate activeRun={activeRun}>
        <WorkbenchShell {...shell} />
      </LiveRunGate>
    </div>
  );
}

// ── Server-side helpers (pure shaping) ───────────────────────────────────────

/** `?page=` → a 1-based integer window index (defensive · default 1). */
function parsePageParam(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 1;
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
