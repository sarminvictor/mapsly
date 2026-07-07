/**
 * `/api/agency/research/[discoveryId]/export` · the FULL-SET CSV export for a
 * research workspace (WP4-4 — every paid lead is exportable, not just the
 * fetched window the workbench page renders).
 *
 * GET → streams `text/csv` (Content-Disposition attachment) with the SAME 13
 * columns as the client "Export CSV" button: both go through the shared
 * `rowToCsvRecord`/`csvLine` mapping in
 * `modules/agency-portal/discover/leads-workbench.ts` — AND, since the
 * 2026-07-06 render-architecture refactor, each batch's row FACTS come from the
 * same `buildWorkbenchRows` (mode: "csv") the two workbench pages use, so the
 * export can never show a third truth. Optional `?list=<listId>` scopes to one
 * saved list (that list's leads, createdAt order); without it the export covers
 * the discovery's whole visible market — the SAME `rawListWhere` scope + order
 * (reviewCount desc NULLS LAST, id asc) the workspace page uses, including the
 * website-havers gate for website-dependent goals. Filter-UNaware by design
 * (the workbench's client filters stay client-side); the scope gate is the same.
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
import type { ActiveSignal } from "@/modules/agency-portal/discover/signal-eval";
import {
  buildWorkbenchRows,
  csvSlug,
  WORKBENCH_BUSINESS_SELECT,
  type WorkbenchScope,
} from "@/modules/agency-portal/discover/workbench-rows";
import {
  CSV_HEADERS,
  csvLine,
  rowToCsvRecord,
} from "@/modules/agency-portal/discover/leads-workbench";

/** Rows fetched + shaped per streamed chunk (bounded queries per chunk). */
const EXPORT_BATCH = 500;
/** Safety ceiling — far above the enrich cap (topN ≤ 5000), never unbounded. */
const EXPORT_MAX_ROWS = 20_000;

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
          const scope = listId
            ? await fetchListBatch(listId, skip)
            : await fetchDiscoveryBatch(listWhere, skip);
          const batchLen =
            scope.kind === "list"
              ? scope.leads.length
              : scope.businesses.length;
          if (batchLen === 0) break;
          const lines = await buildCsvLines(
            scope,
            {
              agencyId,
              discoveryId: discovery.id,
              cellKeys: discovery.cellKeys,
            },
            activeSignals,
            goalSignals,
            includeContacts,
          );
          controller.enqueue(encoder.encode(`${lines.join("\n")}\n`));
          if (batchLen < EXPORT_BATCH) break;
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
): Promise<WorkbenchScope> {
  const businesses = await prisma.business.findMany({
    where: listWhere,
    orderBy: [{ reviewCount: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    skip,
    take: EXPORT_BATCH,
    select: WORKBENCH_BUSINESS_SELECT,
  });
  return { kind: "discovery", businesses };
}

/** One window of a saved list's leads (page order + tiebreaker). */
async function fetchListBatch(
  listId: string,
  skip: number,
): Promise<WorkbenchScope> {
  const leads = await prisma.lead.findMany({
    // WP7-2 · a business suppressed AFTER it was saved to a list must still drop
    // out of the export — filter on the related business's suppressedAt.
    where: { listId, business: { suppressedAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip,
    take: EXPORT_BATCH,
    select: {
      id: true,
      status: true,
      matchScore: true,
      contactedAt: true,
      business: { select: WORKBENCH_BUSINESS_SELECT },
    },
  });
  return { kind: "list", leads };
}

/**
 * Shape one batch into CSV lines via the ONE shared row builder (mode "csv":
 * skips drafts/coverage/bands, excludes opted-out contacts) and the ONE shared
 * rowToCsvRecord mapping. The free-plan wall blanks the contact VALUES after
 * the build — `reachable` was already computed from the full arrays, so the
 * export stays honest about whether contacts EXIST without handing them over.
 */
async function buildCsvLines(
  scope: WorkbenchScope,
  ctx: { agencyId: string; discoveryId: string; cellKeys: readonly string[] },
  activeSignals: ActiveSignal[],
  goalSignals: { key: string; title: string }[],
  includeContacts: boolean,
): Promise<string[]> {
  const { rows } = await buildWorkbenchRows(scope, {
    ...ctx,
    activeSignals,
    mode: "csv",
  });
  return rows.map((r) =>
    csvLine(
      rowToCsvRecord(
        includeContacts ? r : { ...r, phones: [], emails: [] },
        goalSignals,
      ),
    ),
  );
}
