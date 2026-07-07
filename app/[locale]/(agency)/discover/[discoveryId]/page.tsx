/**
 * Agency Discovery WORKSPACE ·
 * `/(agency)/discover/[discoveryId]` (the leads workbench, whole-discovery scope).
 *
 * This is the surface reached by "My research → Open" and the journey's "See the
 * leads workbench" button. In the prototype it is `#view-workspace`: a dense
 * two-tab workspace (Leads · Touchpoints) over the discovery's mapped market —
 * NOT a raw-list overview. We reuse the exact Phase 4 workbench the sibling
 * `lists/[listId]` page uses (`WorkbenchShell` + `LeadsWorkbench` +
 * `TouchpointsTab`); the only difference is scope: a List page builds rows from
 * `list.leads`, this page builds the SAME `WorkbenchLeadRow[]` from the
 * discovery's BUSINESSES (no List needed).
 *
 * The entire side-load → maps → rows/touches/stats pipeline lives in the ONE
 * shared `buildWorkbenchRows` (modules/agency-portal/discover/workbench-rows.ts)
 * — this page only resolves the SCOPE (auth · discovery · the market window)
 * and the header narrative. See the module header for the drift class the
 * shared builder retires.
 *
 * Businesses aren't leads, so each row defaults to status NEW. Where a business
 * already has a `Lead` in one of THIS discovery's saved lists, the builder
 * adopts that Lead's real id + status so the status pill is wired (the
 * optimistic mutation goes through `setLeadStatusAction`). Where no Lead exists
 * yet, the row's id falls back to the business id: the pill still renders +
 * cycles optimistically, but the action finds no Lead and reverts gracefully —
 * effectively display-only until the business is saved into a list.
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
import { cookies } from "next/headers";
import { notFound, unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { cellFreshnessState, parseCellKey } from "@/lib/cell";
import { US_METROS } from "@/lib/geo/us-metros";
import { enrichmentNeedsWebsite } from "@/modules/cost/pricing";
import { rawListWhere } from "@/modules/discovery/raw-list";
import { researchesForSignals } from "@/modules/agency-portal/discover/researches";
import { enrichableCount } from "@/modules/agency-portal/discover/flow-types";
import {
  WORKBENCH_WINDOW,
  WB_COLS_COOKIE,
  defaultActiveColumnsForGoal,
  heavyFieldsForColumns,
  parseWbColsCookie,
} from "@/modules/agency-portal/discover/leads-workbench";
import {
  buildWorkbenchRows,
  csvSlug,
  parsePageParam,
  relativeDays,
  WORKBENCH_BUSINESS_SELECT,
} from "@/modules/agency-portal/discover/workbench-rows";
import {
  activeSignalsFromJson,
  allLibrarySignals,
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
import { LiveRunGate } from "@/modules/agency-portal/discover/components/LiveRunGate";
import {
  resolveActiveRunForDiscovery,
  resolveSpendCreditsForDiscovery,
} from "@/modules/agency-portal/discover/active-run";

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

// The curated signal library's {key,title} option list — built ONCE (pure over
// SIG_META). LIBRARY_OPTIONS is the "+ Signal" picker's option list, gated to
// those with data client-side (#2 · "filter by all signals").
const LIBRARY_OPTIONS = allLibrarySignals();

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
  // keeps skip/take windows non-overlapping). The select is the shared
  // WORKBENCH_BUSINESS_SELECT — the union of the row builder's needs and the
  // signal hydration's scalar reads, so ONE window query feeds both.
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
          select: WORKBENCH_BUSINESS_SELECT,
        });

  // The goal's active signals (key + title) — the workbench renders one
  // column per signal (docs/portal-prototype.html's goalCols/makeSigCol) so
  // what you searched for on the Goal step is directly answered per lead.
  const goalSignals = activeSignals
    .map((s) => {
      const title = SIG_META[s.key]?.title;
      return title ? { key: s.key, title } : null;
    })
    .filter((s): s is { key: string; title: string } => s !== null);
  // WB-COL-1 · the goal's expanded research families — used to turn its own data
  // columns (Site speed / SEO / reviews / ads / rank) ON by default in the
  // workbench, so a goal-based hunt opens showing what you paid for.
  const goalResearches = researchesForSignals(activeSignals);

  // Step 4 · column-driven serialization: the `mapsly-wb-cols` cookie carries
  // the last-saved active-column set (defensive parse — stale keys dropped);
  // no cookie → the goal-default set. Its HEAVY fields ship in the first
  // paint; everything else hydrates lazily when a column toggles on.
  const wbCols = parseWbColsCookie(
    (await cookies()).get(WB_COLS_COOKIE)?.value,
  );
  const serializeHeavyFields = heavyFieldsForColumns(
    wbCols ?? defaultActiveColumnsForGoal(goalResearches),
  );

  // ── The ONE shared pipeline (rows + touches + stats + bands + coverage) ────
  const data = await buildWorkbenchRows(
    { kind: "discovery", businesses },
    {
      agencyId,
      discoveryId: discovery.id,
      cellKeys,
      activeSignals,
      serializeHeavyFields,
    },
  );

  // AUDIT B2/B3 · the honest counts strip. `totalBusinesses` is the ENRICHABLE
  // set (website-gated for site goals) — the header must NOT call that "market"
  // or the "Why 57?" confusion persists. Compute the TRUE market (ungated) and
  // how many leads an enrichment actually ran on, so every number is defined
  // on screen. `enriched` is exact for cells ≤ the coverage window (most), a
  // floor above it.
  const marketTotal =
    goalNeedsWebsite && cellKeys.length > 0
      ? await prisma.business.count({ where: rawListWhere({ cellKeys }) })
      : totalBusinesses;
  // B3 · the enrichable count comes from the ONE shared rule (flow-types.ts)
  // that Preview also uses — website-havers for a site-reading goal, else the
  // whole market. `totalBusinesses` is already the website-gated count (listWhere
  // filters hasWebsite for those goals); `marketTotal` is the ungated total.
  // Surfaced only when it actually differs from the market (site goals) so the
  // header's separate "enrichable" line still appears exactly when it did before.
  const enrichableTotal = enrichableCount(
    researchesForSignals(activeSignals),
    totalBusinesses,
    marketTotal,
  );
  // TRUTH UNIFICATION · one numerator: a lead counts as enriched when a
  // PER-LEAD data group ran (the same predicate the workbench "Enriched only"
  // view uses) — a cell-wide ads/SERP scan no longer counts every lead. The
  // builder's stat strip computes it with the same predicate; reuse it.
  const enrichedCount = data.stats.enriched;
  // `enriched` is exact only when the coverage window covered the WHOLE market;
  // past the window cap it's a floor → the header renders "≥ N" (UX-review #5).
  const enrichedExact =
    data.coverageCount != null && data.coverageCount >= marketTotal;

  // WP4-1 · is an enrichment run still working this discovery's leads? If so
  // (or if one just closed within 60s) the live banner polls the WP3-3 progress
  // endpoint + router.refresh()es new rows in as they enrich. Resolved by
  // cellKey overlap (no discoveryId FK on EnrichmentRun — same as the directory).
  const activeRun = await resolveActiveRunForDiscovery(
    agencyId,
    discovery.id,
    cellKeys,
  );

  // CSV export filename base: "{categorySlug}-{metroSlug}" from the first
  // cell (WP2-4) — the client appends the date. Fallback handled client-side.
  const firstCellForSlug = cellKeys[0] ? parseCellKey(cellKeys[0]) : null;
  const exportSlug = firstCellForSlug
    ? `${csvSlug(firstCellForSlug.categorySlug)}-${csvSlug(firstCellForSlug.metroSlug)}`
    : undefined;

  // ── Header: "{Category} · {Metro}" from the first cell ──────────────────────
  // (Computed BEFORE the shell so the B6 locked-context strip can reuse the
  // market label + the mapped-freshness anchor as plain strings — Pattern 4.)
  const firstCell = cellKeys[0] ? parseCellKey(cellKeys[0]) : null;
  const categoryLabel = firstCell
    ? await resolveCategoryLabel(firstCell.categorySlug)
    : null;
  const metroLabel = firstCell ? resolveMetroLabel(firstCell.metroSlug) : null;
  const title =
    categoryLabel && metroLabel
      ? `${categoryLabel} · ${metroLabel}`
      : (discovery.name ?? "Workspace");

  // Meta line anchor: mapped freshness (also the B6 "Data as of" chip source —
  // the ONE anchor the header's FreshnessChip reads, so the two never disagree).
  const mappedAt = discovery.finishedAt ?? discovery.createdAt;

  const shell: WorkbenchShellProps = {
    leads: {
      rows: data.rows,
      discoveryId,
      bands: data.bands,
      coverageTypeStates: data.coverageTypeStates,
      scannedAt: data.scannedAt,
      goalSignals,
      goalResearches,
      // #2 · the full curated library for the "+ Signal" picker (gated to those
      // with data on every lead, client-side).
      allSignals: LIBRARY_OPTIONS,
      exportSlug,
      serverPage,
      serverPageCount,
      totalRows: totalBusinesses,
      // Streams the FULL set (WP4-4) — same 13 columns via rowToCsvRecord.
      exportAllUrl: `/api/agency/research/${discoveryId}/export`,
      // Step 4 · which HEAVY fields this payload carries — the client hydrates
      // the rest on column toggle (getWorkbenchRowFieldsAction).
      serializedRowFields: [...serializeHeavyFields],
    },
    touchpoints: { touches: data.touches, stats: data.stats },
  };

  // The research goal for the header pill (WP4-14): the persisted goal name,
  // else the base template's title, else no pill (older discoveries).
  const goalMeta = goalMetaFromJson(discovery.signalsJson);
  const goalName =
    goalMeta.goalName ??
    (goalMeta.goalBase
      ? (templateByKey(goalMeta.goalBase)?.title ?? null)
      : null);

  // Meta line: mapped freshness + real spend-to-date credits (settled
  // EnrichmentRun.creditsCharged over this discovery's cells — see SPEND-1).
  const now = new Date();
  const freshness = cellFreshnessState(mappedAt, now);
  const credits = await resolveSpendCreditsForDiscovery(
    agencyId,
    discovery.id,
    cellKeys,
  );

  return (
    <div className="view full">
      {/* WP4-14 · goal pill + market narrative lead; the count reads as
          context ("the 412 med spas in this market · showing 200"), never a
          truncation warning. */}
      <WorkspaceHeader
        title={title}
        goalName={goalName}
        showing={data.rows.length}
        total={totalBusinesses}
        marketTotal={marketTotal}
        enrichable={goalNeedsWebsite ? enrichableTotal : undefined}
        enriched={enrichedCount}
        enrichedExact={enrichedExact}
        marketNoun={marketNoun(categoryLabel)}
        freshness={freshness}
        mappedRelative={relativeDays(mappedAt)}
        credits={credits}
      />

      {/* AUDIT D4 · always-mounted gate — the live banner appears the moment a
          run starts (server activeRun OR the optimistic enrich-started event),
          and the workbench never remounts when it toggles. */}
      <LiveRunGate activeRun={activeRun}>
        <WorkbenchShell {...shell} />
      </LiveRunGate>
    </div>
  );
}

// ── Server-side helpers (pure shaping · header-only) ─────────────────────────

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

/** "medical_spa" → "Medical Spa" — slug fallback when no DB label is found. */
function titleCaseSlug(slug: string): string {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
