// modules/agency-portal/research/status.ts · PURE research-lifecycle logic.
//
// A "research" IS a Discovery row. Its lifecycle status (Draft / Discovered /
// Enriching / Enriched) decides BOTH the directory pill AND where "Open"
// routes — resume the flow at the right step, or the leads workbench when
// enriched. Extracted from queries.ts (which is `server-only` + Prisma) so the
// derivation + the deep-link building are pure, DB-free, and unit-testable.

import { parseCellKey } from "@/lib/cell";
import {
  goalMetaFromJson,
  parseDiscoverySignals,
} from "@/modules/agency-portal/discover/discovery-signals";
import { buildResumeGoalG } from "@/modules/agency-portal/discover/goal-url";

/**
 * Lifecycle status of a research, deciding both the pill AND where "Open"
 * routes:
 *   - draft       mapping not finished (PENDING/RUNNING/FAILED discovery)
 *   - discovered  mapped, no enrichment run yet → resume at Preview (enrich)
 *   - enriching   an enrichment run is in flight → resume at the Enriching step
 *   - partial     enrichment completed with some leads that couldn't finish
 *                 (WP4-2) → the workbench (there ARE leads), amber pill
 *   - enriched    enrichment complete (clean) → the leads workbench
 */
export type ResearchStatus =
  | "draft"
  | "discovered"
  | "delivered"
  | "enriching"
  | "partial"
  | "enriched";

/** Discovery's own persisted status (mirrors the Prisma DiscoveryStatus enum). */
export type DiscoveryStatusValue =
  | "PENDING"
  | "RUNNING"
  | "READY"
  | "PARTIAL"
  | "FAILED";

/** The enrichment state for a discovery, resolved by cellKey overlap. */
export interface EnrichInfo {
  /** none | active (PENDING/RUNNING) | done (OK/PARTIAL). */
  phase: "none" | "active" | "done";
  /** WP4-2 · when phase="done", whether the winning run closed PARTIAL (some
   *  leads couldn't finish) vs OK (clean). Drives the amber "Partial" pill. */
  partial?: boolean;
  /** The in-flight run's id + lead count — only set when phase="active",
   *  used to deep-link back to the Enriching step. */
  activeRunId?: string;
  activeUnits?: number;
  /** SPEND-1 · sum of settled EnrichmentRun.creditsCharged (OK/PARTIAL) over
   *  this discovery's cells — the real "credits to date" the card shows. */
  spendCredits?: number;
  /** FT-2 · this research is a "Search everywhere" that already DELIVERED leads
   *  (an OK run with scopeKind "search"). Drives the "Delivered" pill + routes
   *  the card straight to its leads instead of the enrich flow. */
  delivered?: boolean;
  /** The delivered search's list id — the "Open" target for a delivered card. */
  listId?: string;
}

/** The Discovery fields the pure status/href logic reads. */
export interface ResearchHrefInput {
  id: string;
  status: DiscoveryStatusValue;
  cellKeys: string[];
  signalsJson: unknown;
  totalBusinesses: number;
}

/**
 * Derive the lifecycle status from the discovery's own status + its enrichment
 * phase. A finished mapping (READY/PARTIAL) with no enrichment is "discovered";
 * an in-flight run is "enriching"; a completed run is "enriched"; everything
 * else (still mapping / failed) is "draft".
 */
export function deriveResearchStatus(
  discoveryStatus: DiscoveryStatusValue,
  enrich: EnrichInfo,
): ResearchStatus {
  // FT-2 · a "Search everywhere" already delivered its leads (no enrich step) —
  // its own status, routes straight to the leads, never "Enrich →".
  if (enrich.delivered) return "delivered";
  // WP4-2 · a completed-but-PARTIAL enrichment is its own status (amber pill),
  // but still routes to the workbench — there ARE leads to see.
  if (enrich.phase === "done") return enrich.partial ? "partial" : "enriched";
  if (enrich.phase === "active") return "enriching";
  if (discoveryStatus === "READY" || discoveryStatus === "PARTIAL")
    return "discovered";
  return "draft";
}

/**
 * Build the "Open" deep-link for a research. ENRICHED → the workbench (the
 * current behaviour). Otherwise resume the flow at the right step with the goal
 * + cells reconstructed from persisted state. `cells` uses only cellKeys whose
 * category still resolves to a live BusinessCategory id (a dropped cell just
 * shrinks the resumed selection — GetLeadsFlow's parseCells does the same).
 */
export function buildResearchHref(
  d: ResearchHrefInput,
  status: ResearchStatus,
  enrich: EnrichInfo,
  categoryIdBySlug: Map<string, string>,
): string {
  // FT-2 · a delivered search opens its leads list directly (it never enriched).
  if (status === "delivered")
    return enrich.listId
      ? `/discover/${d.id}/lists/${enrich.listId}`
      : `/discover/${d.id}`;
  // WP4-2 · partial + enriched both open the workbench (there are leads).
  if (status === "enriched" || status === "partial") return `/discover/${d.id}`;

  const cellsParam = d.cellKeys
    .map((k) => {
      const p = parseCellKey(k);
      if (!p) return null;
      const catId = categoryIdBySlug.get(p.categorySlug.toLowerCase());
      return catId ? `${p.metroSlug}:${catId}` : null;
    })
    .filter((s): s is string => s != null)
    .join(",");

  const meta = goalMetaFromJson(d.signalsJson);
  const signals = parseDiscoverySignals(d.signalsJson)?.signals ?? [];
  const g = buildResumeGoalG(meta.goalBase, meta.goalName, signals);

  const qs = new URLSearchParams();
  if (status === "enriching" && enrich.activeRunId) {
    qs.set("step", "enriching");
    qs.set("d", d.id);
    qs.set("run", enrich.activeRunId);
    qs.set("n", String(enrich.activeUnits ?? d.totalBusinesses));
    qs.set("g", g);
    if (cellsParam) qs.set("cells", cellsParam);
  } else {
    // draft OR discovered → resume at Preview (re-mapping is idempotent, so a
    // draft safely re-runs the same Discovery; discovered lands ready-to-enrich).
    qs.set("step", "preview");
    if (status === "discovered") qs.set("d", d.id);
    qs.set("g", g);
    if (cellsParam) qs.set("cells", cellsParam);
    // A cell-scoped research is Target mode — pin ?m=target so the flow doesn't
    // fall to the free default ("search"), which would ignore the cells and
    // land the user on Search-everywhere. Free users then clamp to Market with
    // the picker prefilled + the upgrade CTA (coherent); paid users unchanged.
    if (cellsParam) qs.set("m", "target");
  }
  return `/discover?${qs.toString()}`;
}
