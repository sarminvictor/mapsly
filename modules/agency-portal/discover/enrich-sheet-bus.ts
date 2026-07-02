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
