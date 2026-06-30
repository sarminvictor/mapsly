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
import { Link, redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
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
import {
  WorkbenchShell,
  type WorkbenchShellProps,
} from "@/modules/agency-portal/discover/components/WorkbenchShell";
import type { WorkbenchTouch } from "@/modules/agency-portal/discover/components/TouchpointsTab";
import { parseWhyJson } from "@/modules/agency-portal/discover/touchpoints";

export const metadata: Metadata = {
  title: "Workbench · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string; listId: string }>;
}

/** Hard cap on rows rendered into the workbench (bounded per scalability rule). */
const MAX_LEADS = 500;

export default function ListWorkbenchPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <ListWorkbenchBody params={params} />
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

async function ListWorkbenchBody({ params }: PageProps) {
  const { locale, discoveryId, listId } = await params;
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

  // Load the list + its leads joined to the business facts the workbench needs.
  // Scoped by listId; agency ownership is checked immediately after.
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
      leads: {
        orderBy: { createdAt: "asc" },
        take: MAX_LEADS,
        select: {
          id: true,
          status: true,
          matchScore: true,
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
            },
          },
        },
      },
    },
  });

  // Cross-agency, missing, or a list that doesn't belong to this discovery all
  // read as not-found — we never confirm another agency's data.
  if (!list || list.agencyId !== agencyId || list.discoveryId !== discoveryId) {
    notFound();
  }

  const businessIds = list.leads.map((l) => l.business.id);

  // ── Real signal evaluation (P3) ────────────────────────────────────────────
  // The list belongs to a discovery; that discovery's persisted signals are the
  // research's chosen set. Build ActiveSignal[] via SIG_META, hydrate this list's
  // businesses ONCE (batched, read-only), and resolveMatches per lead for a REAL
  // match% + per-signal verdicts. signalsJson absent / no signals → empty
  // ActiveSignal[] → the per-row fallback keeps the stored-score/heuristic path.
  const discoveryRow = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: { signalsJson: true },
  });
  const activeSignals = activeSignalsFromJson(discoveryRow?.signalsJson);
  const hydrated =
    activeSignals.length > 0 && businessIds.length > 0
      ? await hydrateBusinessForSignals(businessIds)
      : null;
  const evalNow = new Date();

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

  // Touch state per lead (the most-advanced draft status drives the pill).
  const touchByBusiness = new Map<string, TouchState>();
  for (const d of drafts) {
    const t: TouchState = d.status === "sent" ? "Sent" : "Draft";
    const cur = touchByBusiness.get(d.businessId);
    if (!cur || rankTouch(t) > rankTouch(cur))
      touchByBusiness.set(d.businessId, t);
  }

  // ── Build the workbench rows ───────────────────────────────────────────────
  const rows: WorkbenchLeadRow[] = list.leads.map((lead) => {
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
    const evalResult =
      hydrated && hydrated.get(b.id)
        ? resolveMatches(activeSignals, hydrated.get(b.id)!, evalNow)
        : null;
    const { match, matchFromSignals, matchDerived, perSignal } =
      resolveLeadMatch(evalResult, lead.matchScore, pains.length);

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
      touch: touchByBusiness.get(b.id) ?? "None",
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

  // ── vs-cell bands (computed from this list's own cohort) ───────────────────
  const bands: Partial<Record<string, CellBand>> = {
    match: cellBand(rows.map((r) => r.match)) ?? undefined,
    reviews: cellBand(rows.map((r) => r.reviews).filter(isNum)) ?? undefined,
    rating: cellBand(rows.map((r) => r.rating).filter(isNum)) ?? undefined,
    perf: cellBand(rows.map((r) => r.perf).filter(isNum)) ?? undefined,
  };

  // ── Touchpoints tab read-model ─────────────────────────────────────────────
  const leadByBusiness = new Map(
    list.leads.map((l) => [
      l.business.id,
      { id: l.id, status: l.status as LeadStatus },
    ]),
  );
  const nameById = new Map(
    list.leads.map((l) => [l.business.id, l.business.name]),
  );

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

  // Coverage matrix (the doc's batched GET /research/:id/coverage) — fetched
  // server-side via the SHARED loader the endpoint uses, passed to the client as
  // a PLAIN `{ businessId: families[] }` map (Pattern 4). It is keyed by
  // businessId over the whole discovery; this list's businesses are a subset, so
  // each renders its real dot-strip.
  const coverageRows = await loadCoverageMatrix(discoveryId, agencyId);
  const coverage = coverageRows ? coverageMatrixToMap(coverageRows) : {};

  const shell: WorkbenchShellProps = {
    leads: { rows, discoveryId, bands, coverage },
    touchpoints: { touches, stats },
  };

  const cellKey = list.leads[0]?.business.cellKey ?? null;
  const title = cellKey ? prettyCell(cellKey) : list.name;
  const mappedAgo = list.lastRefreshedAt
    ? relativeDays(list.lastRefreshedAt)
    : null;

  return (
    <div className="view full">
      <header className="section">
        <Link
          href={{
            pathname: "/discover/[discoveryId]",
            params: { discoveryId },
          }}
          className="lk"
          style={{ fontSize: 12, color: "var(--muted)" }}
        >
          ← All research
        </Link>
        <h1 style={{ marginTop: 6 }}>{title}</h1>
        <p
          className="note"
          style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}
        >
          {list.name} · {rows.length.toLocaleString()} leads
          {mappedAgo ? ` · mapped ${mappedAgo}` : ""} ·{" "}
          {list.serviceType.toLowerCase().replace(/_/g, " ")}
        </p>
      </header>

      <WorkbenchShell {...shell} />
    </div>
  );
}

// ── Server-side helpers (pure shaping) ───────────────────────────────────────

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
