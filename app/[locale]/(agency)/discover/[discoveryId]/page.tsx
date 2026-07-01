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
import { Link, redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import {
  cellFreshnessState,
  parseCellKey,
  type FreshnessState,
} from "@/lib/cell";
import { US_METROS } from "@/lib/geo/us-metros";
import { usdToCredits } from "@/modules/cost/estimate";
import { rawListWhere } from "@/modules/discovery/raw-list";
import { cellBand } from "@/modules/agency-portal/discover/signals";
import { deriveFamilyCoverage } from "@/modules/agency-portal/discover/family-coverage";
import {
  loadCoverageMatrix,
  coverageMatrixToMap,
} from "@/modules/agency-portal/discover/coverage-matrix";
import {
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
import { activeSignalsFromJson } from "@/modules/agency-portal/discover/discovery-signals";
import { SIG_META } from "@/modules/agency-portal/discover/goal-templates";
import {
  WorkbenchShell,
  type WorkbenchShellProps,
} from "@/modules/agency-portal/discover/components/WorkbenchShell";
import type { WorkbenchTouch } from "@/modules/agency-portal/discover/components/TouchpointsTab";
import { parseWhyJson } from "@/modules/agency-portal/discover/touchpoints";

export const metadata: Metadata = {
  title: "Workspace · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string }>;
}

/**
 * Hard cap on businesses rendered into the workbench. The workbench paginates
 * client-side, so a bounded server fetch (scalability rule) is enough; very
 * large discoveries surface a "showing first N" note.
 */
const MAX_BUSINESSES = 200;

const METRO_NAME_BY_SLUG = new Map(
  US_METROS.map((m) => [m.slug.toLowerCase(), m.name] as const),
);

export default function DiscoveryWorkspacePage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <DiscoveryWorkspaceBody params={params} />
    </Suspense>
  );
}

async function DiscoveryWorkspaceBody({ params }: PageProps) {
  const { locale, discoveryId } = await params;
  setRequestLocale(locale);

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

  // The discovery's businesses (the same hidden/closed gate as the raw list, so
  // the workbench shows the same default market). Ordered like getRawList
  // (reviewCount desc, id asc) for a stable, useful first page.
  const businesses =
    cellKeys.length === 0
      ? []
      : await prisma.business.findMany({
          where: rawListWhere({ cellKeys }),
          orderBy: [{ reviewCount: "desc" }, { id: "asc" }],
          take: MAX_BUSINESSES,
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
          },
        });

  // The whole-market count (for the meta line + "showing first N" note). Falls
  // back to the denormalized total when there are no cells.
  const totalBusinesses =
    cellKeys.length === 0
      ? discovery.totalBusinesses
      : await prisma.business.count({ where: rawListWhere({ cellKeys }) });

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
            where: { businessId: { in: businessIds } },
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

  // ── Real signal evaluation (P3) ────────────────────────────────────────────
  // The research's persisted signals → ActiveSignal[] via SIG_META. When present,
  // we hydrate every business ONCE (batched, read-only, snapshots only) and
  // resolveMatches per lead for a REAL match% + per-signal verdicts — replacing
  // the pain-count heuristic. signalsJson absent / no active signals → empty
  // ActiveSignal[] → the per-row fallback keeps deriveMatchPct (nothing breaks).
  const activeSignals = activeSignalsFromJson(discovery.signalsJson);
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
  const painsById = new Map<
    string,
    { group: string; label: string; title: string }[]
  >();
  for (const f of findings) {
    const label = signalKeyLabel(f.signalKey);
    push(painsById, f.businessId, {
      group: f.group,
      label,
      title: f.explanation || f.pitchAngle || label,
    });
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

  // ── vs-cell bands (computed from this discovery's own cohort) ───────────────
  const bands: Partial<Record<string, CellBand>> = {
    match: cellBand(rows.map((r) => r.match)) ?? undefined,
    reviews: cellBand(rows.map((r) => r.reviews).filter(isNum)) ?? undefined,
    rating: cellBand(rows.map((r) => r.rating).filter(isNum)) ?? undefined,
    perf: cellBand(rows.map((r) => r.perf).filter(isNum)) ?? undefined,
  };

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

  const shell: WorkbenchShellProps = {
    leads: { rows, discoveryId, bands, coverage, goalSignals },
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

  // Meta line: mapped freshness + spend-to-date credits.
  const mappedAt = discovery.finishedAt ?? discovery.createdAt;
  const now = new Date();
  const freshness = cellFreshnessState(mappedAt, now);
  const fresh = freshnessLabel(freshness);
  const credits = usdToCredits(discovery.spendToDateUsd);
  const showingNote =
    totalBusinesses > rows.length
      ? `Showing first ${rows.length.toLocaleString()} of ${totalBusinesses.toLocaleString()}`
      : `${rows.length.toLocaleString()} businesses`;

  return (
    <div className="view full">
      <header className="section">
        <Link href={{ pathname: "/research" }} className="lk">
          ← All research
        </Link>
        <h1 style={{ marginTop: 6 }}>{title}</h1>
        <p className="note" style={{ marginTop: 6 }}>
          {showingNote} ·{" "}
          <span
            className={`freshdot ${fresh.dot}`}
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              borderRadius: "50%",
              verticalAlign: "middle",
            }}
            aria-hidden="true"
          />{" "}
          <span style={{ color: fresh.color, fontWeight: 600 }}>
            {fresh.label}
          </span>{" "}
          · mapped {relativeDays(mappedAt)} · spend to date{" "}
          <span className="cr">
            <span className="ic-coin sm" aria-hidden="true" />
            {credits.toLocaleString()} credits
          </span>
        </p>
      </header>

      <WorkbenchShell {...shell} />
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

/** "medical_spa" → "Medical Spa" — slug fallback when no DB label is found. */
function titleCaseSlug(slug: string): string {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Freshness → dot modifier + label + color (mirrors the prototype meta line). */
function freshnessLabel(state: FreshnessState): {
  dot: string;
  label: string;
  color: string;
} {
  switch (state) {
    case "fresh":
      return { dot: "fresh", label: "Fresh", color: "var(--green)" };
    case "aging":
      return { dot: "aging", label: "Aging", color: "var(--amber)" };
    case "stale":
      return { dot: "stale", label: "Stale", color: "var(--red)" };
    default:
      return { dot: "new", label: "Not mapped", color: "var(--faint)" };
  }
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
