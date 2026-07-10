// modules/agency-portal/discover/enrich-sheet-bus.ts · the tiny client-side
// open-request bus for the in-workbench EnrichMoreSheet (WP5-3).
//
// WHY A BUS: the sheet is mounted ONCE (EnrichMoreHost inside WorkbenchShell),
// but the surfaces that open it live deep in separately-owned trees — the
// coverage panel + Fields-menu locked rows (LeadsWorkbench) and the ghost
// data-domain accordions (LeadDrawer). Threading an onOpen callback through
// every layer would bloat files another editor owns; a window CustomEvent
// keeps each surface's edit to ONE `openEnrichSheet(...)` call. Client-only —
// every caller is already a "use client" component.
//
// The pure `enrichTypesForDomainKey` mapping (drawer domain → enrichment
// families) lives here too so it's unit-testable without React.

import type { EnrichmentType } from "@/modules/cost/pricing";

export interface EnrichSheetScope {
  /** Explicitly selected leads (bulk-bar selection, or the drawer's one lead). */
  selectedBusinessIds?: string[];
  /** The currently visible (filtered) leads. */
  visibleBusinessIds?: string[];
}

export interface EnrichSheetRequest {
  /** Families to pre-select in the sheet (empty → user picks). */
  enrichments?: EnrichmentType[];
  /**
   * AUDIT D1 + ISSUE-2 · when true, the sheet OPENS with `enrichments`
   * already checked. Set by single-field/single-lead CTAs AND by the toolbar
   * "Enrich N · ~X cr" / bulk-bar buttons — those advertise a priced basket, so
   * the sheet MUST open matching it (net on open == the number clicked). Only
   * the un-priced coverage CTA leaves it false.
   */
  preselect?: boolean;
  /** The scope the opener had at hand — the sheet offers it as options. */
  scope?: EnrichSheetScope;
  /**
   * 2026-07-10 · which scope the sheet OPENS on. The toolbar "Enrich N" button
   * is a VISIBLE action → passes "visible"; the bulk-action bar (only present
   * when the user has checked rows) → passes "selected". Without it the sheet
   * falls back to the legacy "selection-wins-else-all" default — which made a
   * STALE row selection silently drive the run ("Selected (8)" the user never
   * made). Ignored if the named scope has no ids (falls back sensibly).
   */
  defaultScope?: EnrichScopeChoice;
}

export type EnrichScopeChoice = "selected" | "visible" | "all";

/**
 * Resolve the scope an EnrichMoreSheet opens on (pure — unit-tested).
 *
 * The OPENER names its intent via `defaultScope`: the toolbar "Enrich N" button
 * is a VISIBLE action ("visible"); the bulk-action bar — only present when the
 * user has checked rows — passes "selected"; the coverage CTA passes "visible".
 * A named scope with no ids falls back sensibly so the sheet never opens on an
 * empty scope: "selected" with no selection → "visible" (or "all" if the view
 * is also empty); "visible" with no visible ids → "all".
 *
 * When the opener names NO scope (legacy / single-lead paths) we keep the P3
 * rule: an explicit SELECTION wins, else the WHOLE research ("all") — "visible"
 * is NEVER an implicit default, because it's the current filter/pagination
 * WINDOW and silently defaulting to it narrowed a rerun to one page (the dental
 * rerun re-enriched 28 of 122). This is also the fix for the phantom
 * "Selected (8)": the toolbar now passes "visible", so a STALE row selection no
 * longer drives its run.
 */
export function resolveDefaultScope(
  defaultScope: EnrichScopeChoice | undefined,
  selectedCount: number,
  visibleCount: number,
): EnrichScopeChoice {
  if (defaultScope === "selected") {
    if (selectedCount > 0) return "selected";
    return visibleCount > 0 ? "visible" : "all";
  }
  if (defaultScope === "visible") return visibleCount > 0 ? "visible" : "all";
  if (defaultScope === "all") return "all";
  // No explicit opener intent → P3 fallback.
  return selectedCount > 0 ? "selected" : "all";
}

const EVENT = "mapsly:enrich-sheet-open";

/** Ask the mounted EnrichMoreSheet host to open with this request. */
export function openEnrichSheet(req: EnrichSheetRequest = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<EnrichSheetRequest>(EVENT, { detail: req }),
  );
}

/** Subscribe to open requests. Returns the unsubscribe function. */
export function subscribeEnrichSheet(
  handler: (req: EnrichSheetRequest) => void,
): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<EnrichSheetRequest>).detail ?? {});
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

// AUDIT D4 · "enrichment started" bus — the moment a run is created client-side
// (runEnrichAction returns its runId), we announce it so the LiveRunGate mounts
// the live banner OPTIMISTICALLY, before the router.refresh() RSC round-trip
// brings the server-resolved activeRun. Kills the "banner only after a refresh".
const STARTED_EVENT = "mapsly:enrich-started";

export function emitEnrichStarted(runId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<string>(STARTED_EVENT, { detail: runId }),
  );
}

export function subscribeEnrichStarted(
  handler: (runId: string) => void,
): () => void {
  const listener = (e: Event) => {
    const id = (e as CustomEvent<string>).detail;
    if (id) handler(id);
  };
  window.addEventListener(STARTED_EVENT, listener);
  return () => window.removeEventListener(STARTED_EVENT, listener);
}

// AUDIT U2/D5 · per-cell "running" scope — a SEPARATE event (so LiveRunGate's
// runId contract is untouched) so the table can flip the exact (business ×
// type) cells being enriched to a "running" state until their real state
// refreshes in.
//
// ISSUE-11 REWORK (2026-07-06) · the payload carries the raw enrichment-type
// TOKENS ("contacts", "tech", "meta_ads", …), NOT the lossy 5-family collapse —
// the family axis cross-lit sibling columns (a Meta run lit the Google column)
// and dropped services/ai_research entirely (the AI-summary column could never
// show a loader). `all` marks a whole-research run (the client has no per-lead
// ids for it — the old guard turned that into a silent no-op and NOTHING lit).
export interface EnrichScopeDetail {
  businessIds: string[];
  /** Raw enrichment-type tokens (resolved, incl. dependencies). */
  types: string[];
  /** True for a whole-research scope — matches EVERY row. */
  all?: boolean;
}
const SCOPE_EVENT = "mapsly:enrich-scope";

export function emitEnrichScope(detail: EnrichScopeDetail): void {
  if (typeof window === "undefined") return;
  if (detail.types.length === 0) return;
  if (detail.businessIds.length === 0 && !detail.all) return;
  window.dispatchEvent(
    new CustomEvent<EnrichScopeDetail>(SCOPE_EVENT, { detail }),
  );
}

export function subscribeEnrichScope(
  handler: (detail: EnrichScopeDetail) => void,
): () => void {
  const listener = (e: Event) => {
    const d = (e as CustomEvent<EnrichScopeDetail>).detail;
    if (d) handler(d);
  };
  window.addEventListener(SCOPE_EVENT, listener);
  return () => window.removeEventListener(SCOPE_EVENT, listener);
}

// ISSUE-11 · "the active run went terminal" — fired by LiveRunGate the moment
// its poll sees a terminal status. The workbench clears its optimistic
// per-cell "enriching…" flags on this signal (the old self-clear gated the
// loader on `state === "not_run"`, which suppressed loaders on every RE-run —
// the exact "no loader, stale None" the owner reported). The 5-min timeout
// stays as the backstop for a run that never reports back.
//
// WB-COL-2 · the event now carries the run's purchased enrichment-type TOKENS
// ("meta_ads", "ai_research", …) — server truth from the progress endpoint's
// terminal payload (run.enrichmentsJson), so the workbench can auto-show the
// bought data's columns even after a reload-mid-run. A no-arg emit still
// compiles (back-compat) and subscribers see `[]`.
const FINISHED_EVENT = "mapsly:enrich-finished";

export function emitEnrichFinished(types?: readonly string[]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<string[]>(FINISHED_EVENT, { detail: [...(types ?? [])] }),
  );
}

export function subscribeEnrichFinished(
  handler: (types: string[]) => void,
): () => void {
  const listener = (e: Event) => {
    const d = (e as CustomEvent<string[]>).detail;
    handler(
      Array.isArray(d)
        ? d.filter((t): t is string => typeof t === "string")
        : [],
    );
  };
  window.addEventListener(FINISHED_EVENT, listener);
  return () => window.removeEventListener(FINISHED_EVENT, listener);
}

// LD-1/LD-2 · "this lead's server-side detail changed" — a touch was generated
// (drafts added) or an enrich run touched the lead. An open LeadDrawer subscribes
// and re-fetches its detail for that businessId, so "This lead's touches" stops
// showing "No touch yet" after a generation, and a background run refreshes the
// drawer IN PLACE instead of the whole page re-suspending and dropping it. Plain
// {businessId} payload — no function crosses the boundary (cache-components P4).
const LEAD_DETAIL_EVENT = "mapsly:lead-detail-changed";

export function emitLeadDetailChanged(businessId: string): void {
  if (typeof window === "undefined" || !businessId) return;
  window.dispatchEvent(
    new CustomEvent<{ businessId: string }>(LEAD_DETAIL_EVENT, {
      detail: { businessId },
    }),
  );
}

export function subscribeLeadDetailChanged(
  handler: (detail: { businessId: string }) => void,
): () => void {
  const listener = (e: Event) => {
    const d = (e as CustomEvent<{ businessId: string }>).detail;
    if (d?.businessId) handler(d);
  };
  window.addEventListener(LEAD_DETAIL_EVENT, listener);
  return () => window.removeEventListener(LEAD_DETAIL_EVENT, listener);
}

/**
 * Map a lead-detail data-domain key (LeadDomainBlock.key) to the enrichment
 * families that unlock it — the drawer's ghost "Enrich to unlock" surface.
 * Mirrors the domain derivations in lead-detail.ts (tech ← BusinessTech,
 * speed ← LighthouseAudit, …). Unknown keys map to [] (nothing to buy).
 */
export function enrichTypesForDomainKey(key: string): EnrichmentType[] {
  switch (key) {
    case "reviews":
      return ["reviews"];
    case "tech":
      return ["tech"];
    case "speed":
      return ["lighthouse"];
    case "meta_ads":
      return ["meta_ads"];
    case "google_ads":
      return ["google_ads"];
    case "serp":
      return ["serp"];
    case "ai":
      // AI brief now includes services — both read the fetched DOM, shown as one
      // "AI brief" door.
      return ["ai_research", "services"];
    default:
      return [];
  }
}
