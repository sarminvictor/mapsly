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
 *   - credits     usdToCredits(spendToDateUsd) — "credits to date".
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
import { usdToCredits } from "@/modules/cost/estimate";
import { goalMetaFromJson } from "@/modules/agency-portal/discover/discovery-signals";
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
  /** "today" — when the research was last opened. */
  opened: string;
  /** Whole "credits to date" (from spend-to-date USD). */
  credits: number;
  /** Total leads across all cells. */
  totalLeads: number;
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
  spendToDateUsd: number;
  lastOpenedAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/**
 * Shape one Discovery row + its per-cell lead counts into a ResearchCard.
 * Pure given `leadCountByCell` + `now` (PPR-safe — no argless `new Date()`).
 */
function toResearchCard(
  d: DiscoveryRow,
  leadCountByCell: Map<string, number>,
  categoryLabelBySlug: Map<string, string>,
  categoryIdBySlug: Map<string, string>,
  enrich: EnrichInfo,
  now: Date,
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

    const leadCount = leadCountByCell.get(key) ?? 0;
    totalLeads += leadCount;
    cells.push({ cellKey: key, metroLabel, leadCount });
  }

  // Fall back to the denormalized whole-research count if no cells resolved.
  if (totalLeads === 0) totalLeads = d.totalBusinesses;

  // "Mapped" anchor = when discovery finished (else created). Drives freshness.
  const mappedAt = d.finishedAt ?? d.createdAt;
  const freshness = cellFreshnessState(mappedAt, now);

  const titleCategory = firstCategory ?? (d.name || "Research");
  const title = firstMetro
    ? `${titleCategory} · ${firstMetro}`
    : d.name || titleCategory;

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
    opened: relativeTime(d.lastOpenedAt ?? mappedAt, now),
    credits: usdToCredits(d.spendToDateUsd),
    totalLeads,
    metros,
    categories,
    isPinned: d.isPinned,
    cells,
  };
}

/**
 * Resolve each discovery's enrichment phase by cellKey overlap. There is no
 * discoveryId FK on EnrichmentRun, so we match `EnrichmentRun.scopeRefsJson
 * .cellKeys` against each `Discovery.cellKeys`. One findMany over the agency's
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
      unitsRequested: true,
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
    let activeRunId: string | undefined;
    let activeUnits: number | undefined;
    for (const r of parsedRuns) {
      // Overlap = the run touches at least one of this discovery's cells.
      const overlaps = d.cellKeys.some((k) => r.cellKeys.has(k));
      if (!overlaps) continue;
      if (r.status === "OK" || r.status === "PARTIAL") {
        phase = "done";
        break; // DONE wins — stop scanning
      }
      if (r.status === "PENDING" || r.status === "RUNNING") {
        phase = "active";
        activeRunId = r.id;
        activeUnits = r.unitsRequested;
        // keep scanning in case a DONE run also overlaps (it would win)
      }
    }
    out.set(d.id, { phase, activeRunId, activeUnits });
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
        spendToDateUsd: true,
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
