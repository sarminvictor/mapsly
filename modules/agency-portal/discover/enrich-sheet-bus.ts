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
   * AUDIT D1 · when true, the sheet OPENS with `enrichments` already checked —
   * set by a single-field/single-lead CTA (a "— enrich" cell or a drawer ghost
   * accordion) so clicking one field pre-selects that enrichment. The bulk
   * "enrich more" / coverage CTA leaves it false so the user isn't surprised by
   * a large pre-selected bill.
   */
  preselect?: boolean;
  /** The scope the opener had at hand — the sheet offers it as options. */
  scope?: EnrichSheetScope;
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
// family) cells being enriched to a "running" state until their real state
// refreshes in. `families` are DataFamily keys.
export interface EnrichScopeDetail {
  businessIds: string[];
  families: string[];
}
const SCOPE_EVENT = "mapsly:enrich-scope";

export function emitEnrichScope(detail: EnrichScopeDetail): void {
  if (typeof window === "undefined") return;
  if (detail.businessIds.length === 0 || detail.families.length === 0) return;
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
    case "ads":
      return ["meta_ads", "google_ads"];
    case "serp":
      return ["serp"];
    case "services":
      return ["services"];
    case "ai":
      return ["ai_research"];
    default:
      return [];
  }
}
