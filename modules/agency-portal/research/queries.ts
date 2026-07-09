/**
 * Agency · My research · list query (Phase 2 · research-list build spec).
 *
 * A "research" IS a Discovery row. This module loads the agency's ACTIVE
 * research (pinned first, then most-recently-opened) and pre-resolves each row
 * into a plain, serializable `ResearchCard` view-model so the page + client
 * card never carry function props across the `'use client'` boundary
 * (cache-components.md Pattern 4).
 *
 * Card view-model derivations (all server-side, all from real fields):
 *   - title       "{Category} · {Metro}" from the first cellKey, slug→label.
 *   - metros[]    distinct metro labels across the discovery's cellKeys.
 *   - categories[]distinct category labels across the cellKeys (for filtering).
 *   - cells[]     per-cell {metroLabel, leadCount}; leadCount = Business rows
 *                 with that cellKey (one groupBy across the whole set).
 *   - totalLeads  Σ per-cell counts (falls back to Discovery.totalBusinesses).
 *   - freshness   fresh|aging|stale from the mapped date vs the 182-day window.
 *   - mapped/opened relative-time strings.
 *   - credits     Σ settled EnrichmentRun.creditsCharged over the cells — the
 *                 real "credits to date" (SPEND-1). Discovery.spendToDateUsd was
 *                 never written, so it always read 0.
 *
 * Per cache-components.md Pattern 1: `'use cache'` + NEXT_PHASE build guard +
 * an EMPTY_* constant of the exact return shape (Vercel's build worker can't
 * open the Neon WebSocket). Tagged `agency-${agencyId}-research`.
 *
 * Copy is English-only for now (the app runs English-only — see i18n/routing.ts).
 */

import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";
import {
  cellFreshnessState,
  parseCellKey,
  type FreshnessState,
} from "@/lib/cell";
import { US_METROS } from "@/lib/geo/us-metros";
import { goalMetaFromJson } from "@/modules/agency-portal/discover/discovery-signals";
import { researchTitle } from "./display-name";
import {
  buildResearchHref,
  deriveResearchStatus,
  type EnrichInfo,
  type ResearchStatus,
} from "./status";

// Re-export so existing importers (the client directory) keep resolving the
// status type from queries — the definition now lives in the pure `status`
// module (server-only-free, unit-tested).
export type { ResearchStatus } from "./status";

/** One informational cell sub-row (location coverage) inside a research card. */
export interface ResearchCardCell {
  cellKey: string;
  /** Category portion of "{category} · {metro}" — a cell is category × metro,
   *  so a cross-category search shows distinct rows per category, not just metro. */
  categoryLabel: string;
  /** Metro portion of "{category} · {metro}" — what the sub-row shows. */
  metroLabel: string;
  /** Live lead count: Business rows in this cell. */
  leadCount: number;
}

/** Plain, serializable view-model for one research card. */
export interface ResearchCard {
  id: string;
  /** "{Category} · {Metro}" — derived from the first cellKey. */
  title: string;
  /** Optional goal label (omitted unless we can derive one). */
  goal: string | null;
  /** Lifecycle status — drives the pill + where "Open" routes. */
  status: ResearchStatus;
  /** Pre-computed deep-link target (plain string — no function crosses the
   *  'use client' boundary). Resumes the flow at the right step, or the
   *  workbench when enriched. */
  href: string;
  /** Freshness dot state (fresh|aging|stale|never). */
  freshness: FreshnessState;
  /** "2 days ago" — when the market was mapped. */
  mapped: string;
  /** "Jul 8, 2026" — absolute map date, so the directory is scannable by when. */
  mappedDate: string;
  /** "today" — when the research was last opened. */
  opened: string;
  /** Whole "credits to date" (from spend-to-date USD). */
  credits: number;
  /** Total leads. For a delivered search this is the DELIVERED count; for a
   *  mapped-only Target research it is the available market size. */
  totalLeads: number;
  /** FT-2 · true when this is a delivered "Search everywhere" — the card shows
   *  delivered leads (not market size) + a "with touches" count, and opens the
   *  leads directly. */
  delivered: boolean;
  /** Delivered leads that carry ≥1 touchpoint (0 unless `delivered`). */
  touchedLeads: number;
  /** Distinct metro labels — used by the Location filter. */
  metros: string[];
  /** Distinct category labels — used by the Category filter. */
  categories: string[];
  isPinned: boolean;
  cells: ResearchCardCell[];
}

export interface ResearchList {
  pinned: ResearchCard[];
  recent: ResearchCard[];
}

/** Build-time / failure fallback — exact shape of the return type. */
export const EMPTY_RESEARCH_LIST: ResearchList = {
  pinned: [],
  recent: [],
};

// ── Label resolution ────────────────────────────────────────────────────────
// cellKey = "categorySlug|metroSlug|country" (lib/cell.ts). Map the slugs to
// human labels; fall back to a title-cased slug when no mapping exists so a card
// always reads cleanly (never "medical_spa|miami|US").

const METRO_NAME_BY_SLUG = new Map(
  US_METROS.map((m) => [m.slug.toLowerCase(), m.name]),
);

/** "Miami, FL" → "Miami" (drop the trailing state for the compact card). */
function shortenMetro(name: string): string {
  return name.split(",")[0].trim();
}

/** "medical_spa" → "Medical Spa" — slug fallback when no DB label is found. */
function titleCaseSlug(slug: string): string {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Relative time (pure, explicit `now`) ─────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** "today" · "3 days ago" · "1 week ago" · "4 months ago" — coarse + honest. */
function relativeTime(at: Date | null, now: Date): string {
  if (!at) return "never";
  const days = Math.floor((now.getTime() - at.getTime()) / MS_PER_DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} week${w === 1 ? "" : "s"} ago`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    return `${m} month${m === 1 ? "" : "s"} ago`;
  }
  const y = Math.floor(days / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

interface DiscoveryRow {
  id: string;
  name: string | null;
  status: "PENDING" | "RUNNING" | "READY" | "PARTIAL" | "FAILED";
  isPinned: boolean;
  cellKeys: string[];
  signalsJson: unknown;
  totalBusinesses: number;
  lastOpenedAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** Delivered-lead counts for one search research (per-cell + total + touches). */
interface DeliveredInfo {
  perCell: Map<string, number>;
  total: number;
  touched: number;
}

/** "Jul 8, 2026" — locale-explicit absolute date (i18n.md: never bare
 *  toLocaleDateString). PPR-safe: `at` is a real date passed in, not read here. */
const ABS_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * Shape one Discovery row + its per-cell lead counts into a ResearchCard.
 * Pure given `leadCountByCell` + `now` (PPR-safe — no argless `new Date()`).
 *
 * `deliveredInfo` (FT-2) is present for a delivered "Search everywhere": its
 * per-cell + total counts are the DELIVERED leads (what the agency paid for),
 * not the available market size — so the card stops advertising market breadth
 * as delivered volume.
 */
function toResearchCard(
  d: DiscoveryRow,
  leadCountByCell: Map<string, number>,
  categoryLabelBySlug: Map<string, string>,
  categoryIdBySlug: Map<string, string>,
  enrich: EnrichInfo,
  now: Date,
  deliveredInfo: DeliveredInfo | null,
): ResearchCard {
  const metros: string[] = [];
  const categories: string[] = [];
  const cells: ResearchCardCell[] = [];
  let firstCategory: string | null = null;
  let firstMetro: string | null = null;
  let totalLeads = 0;

  for (const key of d.cellKeys) {
    const parsed = parseCellKey(key);
    const catSlug = parsed?.categorySlug ?? key;
    const metroSlug = parsed?.metroSlug ?? "";

    const categoryLabel =
      categoryLabelBySlug.get(catSlug.toLowerCase()) ?? titleCaseSlug(catSlug);
    const metroLabel = metroSlug
      ? shortenMetro(
          METRO_NAME_BY_SLUG.get(metroSlug.toLowerCase()) ??
            titleCaseSlug(metroSlug),
        )
      : "—";

    if (firstCategory === null) firstCategory = categoryLabel;
    if (firstMetro === null) firstMetro = metroLabel;
    if (!categories.includes(categoryLabel)) categories.push(categoryLabel);
    if (!metros.includes(metroLabel)) metros.push(metroLabel);

    // Delivered search → DELIVERED leads in this cell; else available market size.
    const leadCount = deliveredInfo
      ? (deliveredInfo.perCell.get(key) ?? 0)
      : (leadCountByCell.get(key) ?? 0);
    totalLeads += leadCount;
    cells.push({ cellKey: key, categoryLabel, metroLabel, leadCount });
  }

  // Delivered total is authoritative (what we charged for); otherwise fall back
  // to the denormalized whole-research count if no cells resolved.
  if (deliveredInfo) totalLeads = deliveredInfo.total;
  else if (totalLeads === 0) totalLeads = d.totalBusinesses;

  // "Mapped" anchor = when discovery finished (else created). Drives freshness.
  const mappedAt = d.finishedAt ?? d.createdAt;
  const freshness = cellFreshnessState(mappedAt, now);

  // Title (shared rule — modules/agency-portal/research/display-name.ts): a set
  // `name` wins verbatim (rename or the SE auto-name); else the scope title from
  // the first-cell labels + count. Same helper the workbench pages now use.
  const title = researchTitle({
    name: d.name,
    cellCount: d.cellKeys.length,
    firstCategory,
    firstMetro,
  });

  const status = deriveResearchStatus(d.status, enrich);
  const href = buildResearchHref(d, status, enrich, categoryIdBySlug);
  const goalLabel = goalMetaFromJson(d.signalsJson).goalName;

  return {
    id: d.id,
    title,
    goal: goalLabel, // the persisted goal name (null on older discoveries)
    status,
    href,
    freshness,
    mapped: relativeTime(mappedAt, now),
    mappedDate: ABS_DATE_FMT.format(mappedAt),
    opened: relativeTime(d.lastOpenedAt ?? mappedAt, now),
    credits: enrich.spendCredits ?? 0,
    totalLeads,
    delivered: enrich.delivered ?? false,
    touchedLeads: deliveredInfo?.touched ?? 0,
    metros,
    categories,
    isPinned: d.isPinned,
    cells,
  };
}

/**
 * Resolve each discovery's enrichment phase. Wave-3 FK (2026-07-06): runs with
 * `discoveryId` attribute exactly; pre-FK rows (null) fall back to the old
 * `scopeRefsJson.cellKeys`-overlap heuristic. One findMany over the agency's
 * recent runs (bounded), bucketed in JS. DONE (OK/PARTIAL) wins over ACTIVE
 * (PENDING/RUNNING) — a completed enrichment routes to the workbench even if a
 * re-enrich is later queued.
 */
async function resolveEnrichPhases(
  agencyId: string,
  discoveries: { id: string; cellKeys: string[] }[],
): Promise<Map<string, EnrichInfo>> {
  const out = new Map<string, EnrichInfo>();
  const runs = await prisma.enrichmentRun.findMany({
    where: { agencyId },
    orderBy: { startedAt: "desc" },
    take: 500,
    select: {
      id: true,
      status: true,
      discoveryId: true,
      unitsRequested: true,
      creditsCharged: true,
      scopeKind: true,
      scopeRefsJson: true,
    },
  });
  // Pre-parse each run's cellKeys once.
  const parsedRuns = runs.map((r) => {
    const scope = (r.scopeRefsJson ?? {}) as { cellKeys?: unknown };
    const cellKeys = Array.isArray(scope.cellKeys)
      ? (scope.cellKeys.filter((k) => typeof k === "string") as string[])
      : [];
    return { ...r, cellKeys: new Set(cellKeys) };
  });

  for (const d of discoveries) {
    let phase: EnrichInfo["phase"] = "none";
    let partial = false;
    let delivered = false;
    let activeRunId: string | undefined;
    let activeUnits: number | undefined;
    // SPEND-1 · sum settled credits across EVERY overlapping OK/PARTIAL run
    // (not just the phase-winner), so the card shows real credits-to-date. Phase
    // still locks on the first (most-recent) settled run — DONE wins — but we
    // keep scanning to accumulate spend.
    let spendCredits = 0;
    let phaseLocked = false;
    for (const r of parsedRuns) {
      // FK first (exact); pre-FK rows fall back to the cellKeys overlap.
      const matches =
        r.discoveryId != null
          ? r.discoveryId === d.id
          : d.cellKeys.some((k) => r.cellKeys.has(k));
      if (!matches) continue;
      if (r.status === "OK" || r.status === "PARTIAL") {
        spendCredits += r.creditsCharged ?? 0;
        if (!phaseLocked) {
          phase = "done";
          // WP4-2 · surface the PARTIAL outcome so the directory shows an amber
          // "Partial" pill (some leads couldn't finish) instead of a clean green.
          partial = r.status === "PARTIAL";
          // FT-2 · a search run (scopeKind "search") delivered leads with no
          // enrich step → its own "Delivered" status downstream.
          delivered = r.scopeKind === "search";
          phaseLocked = true; // DONE wins for phase; keep summing spend
        }
        continue;
      }
      if ((r.status === "PENDING" || r.status === "RUNNING") && !phaseLocked) {
        phase = "active";
        activeRunId = r.id;
        activeUnits = r.unitsRequested;
        // keep scanning in case a DONE run also overlaps (it would win)
      }
    }
    out.set(d.id, {
      phase,
      partial,
      delivered,
      activeRunId,
      activeUnits,
      spendCredits,
    });
  }

  // FT-2 · resolve the delivered searches' list ids (the "Open" target) in one
  // batched read. A search creates exactly one List per Discovery.
  const deliveredIds = [...out.entries()]
    .filter(([, v]) => v.delivered)
    .map(([id]) => id);
  if (deliveredIds.length > 0) {
    const lists = await prisma.list.findMany({
      where: { discoveryId: { in: deliveredIds } },
      orderBy: { createdAt: "asc" },
      select: { id: true, discoveryId: true },
    });
    for (const l of lists) {
      if (!l.discoveryId) continue;
      const info = out.get(l.discoveryId);
      if (info && !info.listId) info.listId = l.id;
    }
  }
  return out;
}

/**
 * FT-2 · per-search DELIVERED-lead counts (per cell + total + with-touches).
 * A delivered search's leads live in one List (list.discoveryId = the search).
 * We count the agency's actual Lead rows — NOT Business rows in the cell — so the
 * card shows what was delivered + how many carry ≥1 touchpoint, not market size.
 * Three bounded, agency-scoped reads; only runs when there are delivered searches.
 */
async function loadDeliveredCounts(
  agencyId: string,
  deliveredDiscoveryIds: string[],
): Promise<Map<string, DeliveredInfo>> {
  const out = new Map<string, DeliveredInfo>();
  if (deliveredDiscoveryIds.length === 0) return out;

  const leads = await prisma.lead.findMany({
    where: { agencyId, list: { discoveryId: { in: deliveredDiscoveryIds } } },
    select: { businessId: true, list: { select: { discoveryId: true } } },
  });
  if (leads.length === 0) return out;

  const businessIds = Array.from(new Set(leads.map((l) => l.businessId)));
  const [bizCells, drafts] = await Promise.all([
    prisma.business.findMany({
      where: { id: { in: businessIds } },
      select: { id: true, cellKey: true },
    }),
    prisma.outreachDraft.findMany({
      where: { agencyId, businessId: { in: businessIds } },
      select: { businessId: true },
    }),
  ]);
  const cellByBusiness = new Map(bizCells.map((b) => [b.id, b.cellKey]));
  const touchedBusinesses = new Set(drafts.map((d) => d.businessId));

  for (const l of leads) {
    const discoveryId = l.list?.discoveryId;
    if (!discoveryId) continue;
    let info = out.get(discoveryId);
    if (!info) {
      info = { perCell: new Map(), total: 0, touched: 0 };
      out.set(discoveryId, info);
    }
    info.total += 1;
    const cell = cellByBusiness.get(l.businessId);
    if (cell) info.perCell.set(cell, (info.perCell.get(cell) ?? 0) + 1);
    if (touchedBusinesses.has(l.businessId)) info.touched += 1;
  }
  return out;
}

/**
 * The agency's research directory: ACTIVE discoveries, pinned-first then most
 * recently opened. Read-only (select-only); no external API in the request path.
 */
export async function getResearchList(agencyId: string): Promise<ResearchList> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`agency-${agencyId}-research`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_RESEARCH_LIST;
  }

  try {
    const discoveries = await prisma.discovery.findMany({
      where: { agencyId, researchStatus: "ACTIVE" },
      orderBy: [
        { isPinned: "desc" },
        { lastOpenedAt: "desc" },
        { createdAt: "desc" },
      ],
      take: 200,
      select: {
        id: true,
        name: true,
        status: true,
        isPinned: true,
        cellKeys: true,
        signalsJson: true,
        totalBusinesses: true,
        lastOpenedAt: true,
        createdAt: true,
        finishedAt: true,
      },
    });

    if (discoveries.length === 0) return EMPTY_RESEARCH_LIST;

    // Per-cell lead counts: one groupBy across every cell in the set.
    const allCellKeys = Array.from(
      new Set(discoveries.flatMap((d) => d.cellKeys)),
    );
    const leadCountByCell = new Map<string, number>();
    const categoryLabelBySlug = new Map<string, string>();
    const categoryIdBySlug = new Map<string, string>();

    if (allCellKeys.length > 0) {
      const grouped = await prisma.business.groupBy({
        by: ["cellKey"],
        where: { cellKey: { in: allCellKeys } },
        _count: { _all: true },
      });
      for (const g of grouped) {
        if (g.cellKey) leadCountByCell.set(g.cellKey, g._count._all);
      }

      // Resolve category slug → human label + live id from BusinessCategory
      // (the id rebuilds the `cells=metroSlug:categoryId` resume param).
      const catSlugs = Array.from(
        new Set(
          allCellKeys
            .map((k) => parseCellKey(k)?.categorySlug)
            .filter((s): s is string => Boolean(s)),
        ),
      );
      if (catSlugs.length > 0) {
        const cats = await prisma.businessCategory.findMany({
          where: { dataforseoId: { in: catSlugs } },
          select: { id: true, dataforseoId: true, label: true },
        });
        for (const c of cats) {
          categoryLabelBySlug.set(c.dataforseoId.toLowerCase(), c.label);
          categoryIdBySlug.set(c.dataforseoId.toLowerCase(), c.id);
        }
      }
    }

    // Enrichment phase per discovery — resolved by cellKey overlap (there is no
    // discoveryId FK on EnrichmentRun; its scopeRefsJson.cellKeys overlap the
    // discovery's cellKeys). One findMany over the agency's recent runs, bucketed
    // in JS. A DONE run (OK/PARTIAL) beats an ACTIVE one (a re-enrich in flight).
    const enrichByDiscovery = await resolveEnrichPhases(agencyId, discoveries);

    // FT-2 · DELIVERED-lead counts for search researches (delivered/with-touches,
    // not market size). Only runs when the set contains delivered searches.
    const deliveredData = await loadDeliveredCounts(
      agencyId,
      discoveries
        .filter((d) => enrichByDiscovery.get(d.id)?.delivered)
        .map((d) => d.id),
    );

    // `now` is read once at request time — the function is uncached at runtime
    // (cacheLife('minutes')) so this is a request-scoped read, PPR-safe.
    const now = new Date();

    const cards = discoveries.map((d) =>
      toResearchCard(
        d,
        leadCountByCell,
        categoryLabelBySlug,
        categoryIdBySlug,
        enrichByDiscovery.get(d.id) ?? { phase: "none" },
        now,
        deliveredData.get(d.id) ?? null,
      ),
    );

    return {
      pinned: cards.filter((c) => c.isPinned),
      recent: cards.filter((c) => !c.isPinned),
    };
  } catch {
    return EMPTY_RESEARCH_LIST;
  }
}

/** Slim research link for the ⌘K palette (WP4-7) — plain serializable data. */
export interface RecentResearchLink {
  id: string;
  title: string;
  /** Pre-computed deep-link (workbench when enriched, else resume the flow). */
  href: string;
}

/**
 * The agency's most recent researches as slim `{id,title,href}` links for the
 * ⌘K command palette (WP4-7). Reuses the cached `getResearchList` (one source
 * of truth for status + href), projects to the palette shape, and caps at
 * `limit` (pinned-first then most-recent, matching the directory order).
 */
export async function getRecentResearchLinks(
  agencyId: string,
  limit = 6,
): Promise<RecentResearchLink[]> {
  const list = await getResearchList(agencyId);
  return [...list.pinned, ...list.recent]
    .slice(0, limit)
    .map((c) => ({ id: c.id, title: c.title, href: c.href }));
}
