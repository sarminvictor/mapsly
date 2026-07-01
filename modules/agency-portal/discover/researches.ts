// modules/agency-portal/discover/researches.ts · the research-DEPENDENCY
// resolver for the agency discover flow.
//
// THE PROBLEM THIS REPLACES.
// `familiesForSignals()` (goal-templates.ts) looked each active signal up in the
// agency-signal registry and mapped its `source` field to ONE enrichment family.
// But only ~22 of the 74-signal registry are agency signals, so ~48% of the
// goal library's signals fell through `agencySignals.find(...) === undefined`
// and silently resolved to NO family — their data was never collected, so they
// could never be evaluated. Composites that need TWO families (ads-without-pixel
// = meta_ads + tech) only got one. Dependency chains (tech rides the contacts
// DOM fetch) were invisible.
//
// THE FIX.
// Every goal signal DECLARES the research families it depends on, directly on
// its SigMeta (`researches`, a REQUIRED field — TypeScript forces every signal
// to declare, so nothing can silently drop). This module is the pure resolver:
//
//   1. RESEARCH_DEPS  — research→prerequisite chains (e.g. tech rides contacts).
//   2. resolveResearches(seed) — transitive closure over RESEARCH_DEPS (cycle-
//      safe, stable de-duped order). A `tech` seed expands to [contacts, tech].
//   3. researchesForSignals(activeSignals) — union each signal's declared
//      `researches`, then resolve. THIS is what the discover flow calls.
//
// The output is `EnrichmentType[]` — the SAME shape the old resolver produced —
// so `preflightEnrichAction({ enrichments })`, `enrichCreditsFor`, and the
// dispatch all keep working unchanged. A research that's a cell-level family
// (meta_ads / google_ads / serp) vs per-business is routed by the dispatch
// (modules/enrichment/dispatch.ts) — this module only produces the correct SET.

import {
  ALL_ENRICHMENT_TYPES,
  type EnrichmentType,
} from "@/modules/cost/pricing";
import { SIG_META } from "./goal-templates";

/**
 * A research is one enrichment family the workflow can run. Aliased to
 * `EnrichmentType` (the canonical price-list id) so a "research" and an
 * "enrichment family" are the same thing — this is just the discover flow's
 * vocabulary for it.
 */
export type Research = EnrichmentType;

/**
 * RESEARCH_DEPS · research → its prerequisite researches.
 *
 * A genuine chain means "you CANNOT collect research X without also running its
 * prerequisites in the same workflow". The resolver expands these transitively,
 * so a signal only needs to declare the LEAF research it reads — the chain pulls
 * in everything underneath.
 *
 * Keep this list to REAL mechanical dependencies only (data-driven, no
 * heuristics) so the closure stays honest.
 */
export const RESEARCH_DEPS: Partial<Record<Research, Research[]>> = {
  // The contacts DOM scan (scanBusinessContacts) ALSO produces the tech
  // fingerprint off the SAME fetch — the dispatch collapses contacts+tech into
  // ONE per-business CONTACTS job (see buildJobPlan in dispatch.ts). So any
  // signal that needs `tech` must pull in `contacts`: there is no tech fetch
  // that isn't the contacts fetch. This is the one load-bearing chain today.
  tech: ["contacts"],
  // NOTE on lighthouse: Lighthouse runs per-business but is its OWN fetch (DfS
  // on-page Lighthouse / on-demand actor) — it does NOT ride the contacts scan,
  // so it has no prerequisite here. It can run on a business we never scanned
  // for contacts. (If a future pipeline change makes Lighthouse ride the DOM
  // fetch, add `lighthouse: ["contacts"]` here and the closure handles it.)
  // NOTE on services / ai_research: both are their own per-business jobs over
  // already-extracted page text; neither requires another family to have run
  // first in the dispatch, so neither has a prerequisite.
  // NOTE on the cell families (meta_ads / google_ads / serp): each runs inline
  // per-cell independently — no prerequisites.
};

/**
 * RESEARCH_LABELS · human labels for the UI (cost preview, enriching rollup).
 * One per EnrichmentType so the UI can name every research it's about to run.
 */
export const RESEARCH_LABELS: Record<Research, string> = {
  contacts: "Contacts (DOM scan)",
  tech: "Website & tech (DOM scan)",
  reviews: "Reviews (DataForSEO)",
  meta_ads: "Meta ads (Apify)",
  google_ads: "Google ads",
  serp: "SERP / search",
  lighthouse: "Site speed (Lighthouse)",
  services: "Services (AI)",
  ai_research: "AI research",
};

/**
 * RESEARCH_SOURCES · short "where this comes from" subtitle, paired with
 * {@link RESEARCH_LABELS} for the research-grouped UI (Preview's "What you
 * picked" — docs/portal-prototype.html's `<span class="src">` pattern).
 */
export const RESEARCH_SOURCES: Record<Research, string> = {
  contacts: "DOM scan of the business website",
  tech: "DOM scan of the business website",
  reviews: "DataForSEO Google reviews pull",
  meta_ads: "Meta Ad Library",
  google_ads: "Google Ads Transparency Center",
  serp: "Google search results",
  lighthouse: "On-page Lighthouse audit",
  services: "AI read of the site + listing",
  ai_research: "AI read of the site + listing",
};

/**
 * resolveResearches · pure transitive closure over {@link RESEARCH_DEPS}.
 *
 * Given a seed set of researches, returns every research that must run — the
 * seeds plus all their (transitive) prerequisites — in a STABLE, de-duped order:
 * the canonical price-list order (ALL_ENRICHMENT_TYPES), so callers get the same
 * array regardless of seed order. Cycle-safe: a research is only expanded once,
 * so a hypothetical `a→b→a` chain terminates instead of looping forever.
 */
export function resolveResearches(seed: Research[]): Research[] {
  const resolved = new Set<Research>();

  const visit = (r: Research): void => {
    if (resolved.has(r)) return; // already expanded → cycle-safe + de-duped
    resolved.add(r);
    for (const dep of RESEARCH_DEPS[r] ?? []) visit(dep);
  };
  for (const r of seed) visit(r);

  // Emit in canonical price-list order for a stable, deterministic result.
  return ALL_ENRICHMENT_TYPES.filter((t) => resolved.has(t));
}

/**
 * researchesForSignals · the discover-flow resolver (replaces
 * `familiesForSignals`).
 *
 * Unions every active signal's DECLARED `researches` (from its SigMeta), then
 * runs {@link resolveResearches} so dependency chains (tech → contacts) are
 * pulled in. Returns the de-duped `EnrichmentType[]` the discover flow feeds to
 * `preflightEnrichAction({ enrichments })`.
 *
 * goal-templates.ts ⇄ researches.ts form an ES-module import cycle (goal-
 * templates re-exports the thin `familiesForSignals` wrapper from here; we
 * import SIG_META from there). The cycle is SAFE: `SIG_META` is only read when
 * this function is CALLED (render time), never at module-init, so by the time
 * any call happens both modules have fully initialized.
 */
export function researchesForSignals(
  activeSignals: { key: string }[],
): Research[] {
  const seed = new Set<Research>();
  for (const sig of activeSignals) {
    const meta = SIG_META[sig.key];
    if (!meta) continue; // unknown key — nothing to collect (no silent family)
    for (const r of meta.researches) seed.add(r);
  }
  return resolveResearches([...seed]);
}

/** One research-grouped row for the "What you picked" panel. */
export interface PickedGroup {
  /** "discovery" (synthetic, free) or a real Research key. */
  key: string;
  label: string;
  source: string;
  /** Signal titles that read from this research — see groupSignalsByResearch. */
  titles: string[];
}

/**
 * groupSignalsByResearch · docs/portal-prototype.html's `pickedGroups`
 * pattern, driven by REAL `SIG_META.researches` (not the prototype's mock
 * signal→research mapping). A signal with NO researches is read straight off
 * the free Google Maps listing, so it surfaces under a synthetic "discovery"
 * group; a signal needing more than one research appears under EACH —
 * showing every place we'll actually go get that fact, not just the first.
 *
 * `families` should be `researchesForSignals(activeSignals)` — passed in
 * rather than recomputed so callers that already have it (every current
 * caller does) get one canonical ordering instead of two independent passes.
 */
export function groupSignalsByResearch(
  activeSignals: { key: string }[],
  families: Research[],
): PickedGroup[] {
  const byResearch = new Map<string, string[]>();
  for (const f of activeSignals) {
    const meta = SIG_META[f.key];
    if (!meta) continue;
    const researches: string[] = meta.researches.length
      ? meta.researches
      : ["discovery"];
    for (const r of researches) {
      const titles = byResearch.get(r);
      if (titles) titles.push(meta.title);
      else byResearch.set(r, [meta.title]);
    }
  }
  return ["discovery", ...families]
    .filter((r) => byResearch.has(r))
    .map((r) => ({
      key: r,
      label: r === "discovery" ? "Discovery" : RESEARCH_LABELS[r as Research],
      source:
        r === "discovery"
          ? "Google Maps listing"
          : RESEARCH_SOURCES[r as Research],
      titles: byResearch.get(r)!,
    }));
}
