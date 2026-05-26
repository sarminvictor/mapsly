/**
 * Shared types for the layered service-detection pipeline.
 *
 * Detectors return `ServiceCandidate[]`. The orchestrator
 * (`detect-services.ts`) merges candidates from all layers, dedupes
 * by canonical key (highest-confidence source wins), and persists
 * them as `BusinessService` rows tagged with `source`.
 */

/**
 * One row in a vertical's canonical service list. A vertical has
 * one taxonomy file (e.g. `taxonomy-med-spa.ts`).
 */
export interface ServiceTaxonomyEntry {
  /** Stable id used for merging across detectors. Snake_case ASCII. */
  canonicalKey: string;
  /** Display label · plain English · SMB voice. */
  displayName: string;
  /** Optional grouping used for `BusinessService.category` and for
   *  visual sectioning in the /my-business editor. */
  group: string;
  /** Strings to match against. Lowercased on declaration. Each becomes
   *  a word-boundary regex at runtime — order doesn't matter. */
  synonyms: readonly string[];
}

export type ServiceSourceHint =
  | "auto:google" // Layer 1 · category → starter map (existing flow)
  | "auto:place-topics" // Layer 2 · DfS review topics
  | "auto:description" // Layer 3 · DfS long-form description
  | "auto:dom" // Layer 4a · website /services /menu /etc scrape
  | "auto:js-bundle"; // Layer 4b · SPA JS bundle string match (SPAs hide everything in JS)

export interface ServiceCandidate {
  /** Stable id from the taxonomy. */
  canonicalKey: string;
  /** Display label persisted to BusinessService.name. */
  displayName: string;
  /** Group label persisted to BusinessService.category. */
  group: string;
  /** 0..1 · how confident we are. Higher wins on dedup. */
  confidence: number;
  /** Which layer detected it · drives BusinessService.source. */
  sourceHint: ServiceSourceHint;
  /** Optional raw snippet used to derive — kept for debugging only. */
  evidence?: string;
}
