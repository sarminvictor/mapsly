/**
 * `/api/agency/research/[discoveryId]/export` · the FULL-SET CSV export for a
 * research workspace (WP4-4 — every paid lead is exportable, not just the
 * fetched window the workbench page renders).
 *
 * GET → streams `text/csv` (Content-Disposition attachment) with the SAME 13
 * columns as the client "Export CSV" button: both go through the shared
 * `rowToCsvRecord`/`csvLine` mapping in
 * `modules/agency-portal/discover/leads-workbench.ts`, so the two exports can
 * never drift. Optional `?list=<listId>` scopes to one saved list (that list's
 * leads, createdAt order); without it the export covers the discovery's whole
 * visible market — the SAME `rawListWhere` scope + order (reviewCount desc
 * NULLS LAST, id asc) the workspace page uses, including the website-havers
 * gate for website-dependent goals. Filter-UNaware by design (the workbench's
 * client filters stay client-side); the scope gate is the same.
 *
 * Streaming: rows are produced in EXPORT_BATCH (500) chunks — bounded queries,
 * bounded side-loads per chunk — and enqueued as they're built, so a 5k-lead
 * export starts downloading immediately and never holds the whole set in
 * memory. EXPORT_MAX_ROWS (20k) is the safety ceiling per the scalability
 * rule (unbounded scans are banned); it is far above the enrich cap
 * (topN ≤ 5000), so every PAID set fits.
 *
 * Per `.claude/rules/security.md`:
 *   - Auth-gated · agency resolved from the session, NEVER a query/route param.
 *   - No cross-agency leak · the discovery (and the optional list) must belong
 *     to the resolved agency (missing / cross-agency → 404).
 * Per `.claude/rules/cost-discipline.md` · no external API, no CronRun (pure DB).
 * Per `.claude/rules/performance.md` · `private, no-store` (per-agency data).
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import prisma, { Prisma } from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import { rawListWhere } from "@/modules/discovery/raw-list";
import { isPaidAgency } from "@/modules/agency-portal/team/seats";
import { trackProductEvent } from "@/lib/analytics/product-events";
import { enrichmentNeedsWebsite } from "@/modules/cost/pricing";
import { researchesForSignals } from "@/modules/agency-portal/discover/researches";
import { activeSignalsFromJson } from "@/modules/agency-portal/discover/discovery-signals";
import { SIG_META } from "@/modules/agency-portal/discover/goal-templates";
import {
  hydrateBusinessForSignals,
  resolveMatches,
  type ActiveSignal,
} from "@/modules/agency-portal/discover/signal-eval";
import {
  CSV_HEADERS,
  csvLine,
  resolveLeadMatch,
  rowToCsvRecord,
  type CsvExportRow,
  type LeadStatus,
} from "@/modules/agency-portal/discover/leads-workbench";

/** Rows fetched + shaped per streamed chunk (bounded queries per chunk). */
const EXPORT_BATCH = 500;
/** Safety ceiling — far above the enrich cap (topN ≤ 5000), never unbounded. */
const EXPORT_MAX_ROWS = 20_000;

const BIZ_SELECT = {
  id: true,
  name: true,
  address: true,
  city: true,
  cellKey: true,
  rating: true,
  reviewCount: true,
  reachableChannelCount: true,
  phone: true,
  email: true,
  website: true,
} as const;

type BizForCsv = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  cellKey: string | null;
  rating: number | null;
  reviewCount: number | null;
  reachableChannelCount: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

/** One export item: the business + (list scope) its lead's status/score. */
interface ExportItem {
  biz: BizForCsv;
  status: LeadStatus | null;
  matchScore: number | null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ discoveryId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { agencyId: true },
  });
  if (!member) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const agencyId = member.agencyId;

  // WP7-5 · free-tier upgrade wall. Contacts (emails/phones) are visible in-app
  // (drawer / workbench) on every plan, but the CSV-WITH-CONTACTS export is a
  // paid feature — a Free agency's export keeps the contact columns (stable
  // shape) but blanks their values. This is the natural upgrade wall: Tom can
  // see the leads for free, but exporting the contacts for his sending tool
  // requires a paid plan. No card needed to TRY — only to EXPORT contacts.
  const agencyForPlan = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { stripeStatus: true },
  });
  const includeContacts = isPaidAgency(agencyForPlan?.stripeStatus ?? null);

  const { discoveryId } = await params;
  const listId = new URL(request.url).searchParams.get("list");

  const discovery = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: { id: true, agencyId: true, cellKeys: true, signalsJson: true },
  });
  // Missing / cross-agency reads as not-found — we never confirm another
  // agency's data.
  if (!discovery || discovery.agencyId !== agencyId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Optional list scope — must belong to this agency AND this discovery.
  if (listId) {
    const list = await prisma.list.findUnique({
      where: { id: listId },
      select: { agencyId: true, discoveryId: true },
    });
    if (
      !list ||
      list.agencyId !== agencyId ||
      list.discoveryId !== discovery.id
    ) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  }

  // Same signal set + scope gate as the workspace page: website-dependent
  // goals hide website-less businesses (they were never enriched).
  const activeSignals = activeSignalsFromJson(discovery.signalsJson);
  const goalSignals = activeSignals
    .map((s) => {
      const title = SIG_META[s.key]?.title;
      return title ? { key: s.key, title } : null;
    })
    .filter((s): s is { key: string; title: string } => s !== null);
  const goalNeedsWebsite = enrichmentNeedsWebsite(
    researchesForSignals(activeSignals),
  );
  const listWhere = rawListWhere({
    cellKeys: discovery.cellKeys,
    filters: goalNeedsWebsite ? { hasWebsite: true } : undefined,
  });

  // "{categorySlug}-{metroSlug}-{yyyy-mm-dd}.csv" (same shape as the client).
  const firstCell = discovery.cellKeys[0]
    ? parseCellKey(discovery.cellKeys[0])
    : null;
  const slug = firstCell
    ? `${csvSlug(firstCell.categorySlug)}-${csvSlug(firstCell.metroSlug)}`
    : "leads";
  const filename = `${slug}-${new Date().toISOString().slice(0, 10)}.csv`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`${CSV_HEADERS.join(",")}\n`));
        let skip = 0;
        while (skip < EXPORT_MAX_ROWS) {
          const items = listId
            ? await fetchListBatch(listId, skip)
            : await fetchDiscoveryBatch(listWhere, skip);
          if (items.length === 0) break;
          const lines = await buildCsvLines(
            items,
            listId ? null : { agencyId, discoveryId: discovery.id },
            activeSignals,
            goalSignals,
            includeContacts,
          );
          controller.enqueue(encoder.encode(`${lines.join("\n")}\n`));
          if (items.length < EXPORT_BATCH) break;
          skip += EXPORT_BATCH;
        }
        controller.close();
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "research.export.error",
            discoveryId,
            listId: listId ?? undefined,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        controller.error(err);
      }
    },
  });

  // WP6-4 · csv_exported — the contacts Tom paid for leave the product (the
  // strongest "activated + getting value" signal). Fired once per authorized
  // export (before the stream drains — the scope is already validated). Records
  // the scope shape only (no exported rows/PII); fire-and-forget.
  void trackProductEvent({
    type: "csv_exported",
    agencyId,
    userId: session.user.id,
    props: { discoveryId: discovery.id, scope: listId ? "list" : "research" },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** One window of the discovery's visible market (page order + tiebreaker). */
async function fetchDiscoveryBatch(
  listWhere: Prisma.BusinessWhereInput,
  skip: number,
): Promise<ExportItem[]> {
  const businesses = await prisma.business.findMany({
    where: listWhere,
    orderBy: [{ reviewCount: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    skip,
    take: EXPORT_BATCH,
    select: BIZ_SELECT,
  });
  return businesses.map((biz) => ({ biz, status: null, matchScore: null }));
}

/** One window of a saved list's leads (page order + tiebreaker). */
async function fetchListBatch(
  listId: string,
  skip: number,
): Promise<ExportItem[]> {
  const leads = await prisma.lead.findMany({
    // WP7-2 · a business suppressed AFTER it was saved to a list must still drop
    // out of the export — filter on the related business's suppressedAt.
    where: { listId, business: { suppressedAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip,
    take: EXPORT_BATCH,
    select: {
      status: true,
      matchScore: true,
      business: { select: BIZ_SELECT },
    },
  });
  return leads.map((l) => ({
    biz: l.business,
    status: l.status as LeadStatus,
    matchScore: l.matchScore,
  }));
}

/**
 * Shape one batch into CSV lines — the same facts the workbench rows carry
 * (latest snapshot/audit, contacts, flagged findings, real signal eval), then
 * through the SHARED rowToCsvRecord mapping. All side-loads are scoped to the
 * batch's business ids (bounded per the scalability rule).
 */
async function buildCsvLines(
  items: ExportItem[],
  // Discovery scope only: adopt each business's Lead status from this
  // discovery's saved lists (same rule as the workspace page). Null for the
  // list scope (the item already carries its lead's status).
  adoptLeadsFrom: { agencyId: string; discoveryId: string } | null,
  activeSignals: ActiveSignal[],
  goalSignals: { key: string; title: string }[],
  // WP7-5 · when false (Free plan), the contact columns are emptied — the
  // upgrade wall. `reachable` still reflects reachableChannelCount so the wall
  // is honest about whether contacts EXIST (Tom sees they're there, behind pay).
  includeContacts: boolean,
): Promise<string[]> {
  const ids = items.map((i) => i.biz.id);

  const [snapshots, audits, findings, contacts, existingLeads] =
    await Promise.all([
      prisma.businessSnapshot.findMany({
        where: { businessId: { in: ids } },
        orderBy: { snapshotDate: "desc" },
        select: { businessId: true, reviewCount: true, rating: true },
      }),
      prisma.lighthouseAudit.findMany({
        where: { businessId: { in: ids } },
        orderBy: { auditedAt: "desc" },
        select: { businessId: true, performance: true },
      }),
      prisma.playbookFinding.findMany({
        where: { businessId: { in: ids }, status: "flagged" },
        select: {
          businessId: true,
          signalKey: true,
          confidence: true,
          pitchAngle: true,
        },
      }),
      prisma.contact.findMany({
        // WP7-2 · opted-out contacts (Contact.optedOutAt, set via /opt-out or a
        // wrong-data dispute) never leave the product in an export.
        where: { businessId: { in: ids }, optedOutAt: null },
        select: { businessId: true, channel: true, value: true },
      }),
      adoptLeadsFrom
        ? prisma.lead.findMany({
            where: {
              agencyId: adoptLeadsFrom.agencyId,
              businessId: { in: ids },
              list: { discoveryId: adoptLeadsFrom.discoveryId },
            },
            orderBy: { statusChangedAt: "desc" },
            select: { businessId: true, status: true },
          })
        : Promise.resolve([]),
    ]);

  const hydrated =
    activeSignals.length > 0 && ids.length > 0
      ? await hydrateBusinessForSignals(ids)
      : null;
  const evalNow = new Date();

  // First (=latest) row per business.
  const latestSnapshot = firstByBusiness(snapshots);
  const latestAudit = firstByBusiness(audits);
  const statusByBusiness = firstByBusiness(existingLeads);

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

  // Flagged findings, most-confident first (JS rank — a DB orderBy on the
  // string rank sorts alphabetically, WP2-4). Drives the pain-label fallback
  // in "Top signals" + the strongest pitch angle.
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
  const pitchById = new Map<string, string>();
  for (const f of rankedFindings) {
    const label = signalKeyLabel(f.signalKey);
    push(painsById, f.businessId, { group: "more", label, title: label });
    if (f.pitchAngle && !pitchById.has(f.businessId)) {
      pitchById.set(f.businessId, f.pitchAngle);
    }
  }

  return items.map((item) => {
    const b = item.biz;
    const snap = latestSnapshot.get(b.id);
    const audit = latestAudit.get(b.id);
    const allPhones = phonesById.get(b.id) ?? (b.phone ? [b.phone] : []);
    const allEmails = emailsById.get(b.id) ?? (b.email ? [b.email] : []);
    // WP7-5 · Free plan → blank the exported contact values (upgrade wall). The
    // `reachable` flag below is still computed from allPhones/allEmails so the
    // export honestly says "contacts exist" without handing them over.
    const phones = includeContacts ? allPhones : [];
    const emails = includeContacts ? allEmails : [];
    const pains = painsById.get(b.id) ?? [];
    const evalResult =
      hydrated && hydrated.get(b.id)
        ? resolveMatches(activeSignals, hydrated.get(b.id)!, evalNow)
        : null;
    const { match, perSignal } = resolveLeadMatch(
      evalResult,
      item.matchScore,
      pains.length,
    );
    const row: CsvExportRow = {
      name: b.name,
      addr: [b.address ?? b.city ?? "", prettyCell(b.cellKey)]
        .filter(Boolean)
        .join(" · "),
      match,
      status:
        item.status ??
        (statusByBusiness.get(b.id)?.status as LeadStatus | undefined) ??
        "NEW",
      reachable:
        (b.reachableChannelCount ?? 0) > 0 ||
        allPhones.length > 0 ||
        allEmails.length > 0,
      emails,
      phones,
      website: b.website ?? null,
      rating: snap?.rating ?? b.rating ?? null,
      reviews: snap?.reviewCount ?? b.reviewCount ?? null,
      perf: audit?.performance ?? null,
      perSignal,
      pains: pains.map((p) => ({ ...p, group: "more" as const })),
      pitchAngle: pitchById.get(b.id) ?? null,
    };
    return csvLine(rowToCsvRecord(row, goalSignals));
  });
}

// ── Small pure helpers (mirrors the workbench pages) ─────────────────────────

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

/** "perf_savings_ms" → "Perf savings ms" (best-effort signal-key label). */
function signalKeyLabel(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
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
