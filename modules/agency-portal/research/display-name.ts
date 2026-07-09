// Shared research display-name + markets helpers (pure, no DB).
//
// One source of truth for "what a research is called" so /research, the market
// workbench, and the list workbench stop diverging (the lists page used to
// title itself off the first lead's cell → "Acupuncture clinic · Boise" for a
// cross-market Search-everywhere run, while /research showed the real name).
//
// The rule (matches the /research card, queries.ts): a set Discovery.name ALWAYS
// wins verbatim — it's either a user rename or the auto-name ("SE · Website
// redesign"). Only an UN-named research derives a scope title: single market →
// "{Category} · {Metro}"; multi-market → "{Category} · N markets".

import { parseCellKey } from "@/lib/cell";
import { US_METROS } from "@/lib/geo/us-metros";

const METRO_NAME_BY_SLUG = new Map(
  US_METROS.map((m) => [m.slug.toLowerCase(), m.name]),
);

/** "medical_spa" → "Medical Spa" — slug fallback when no DB label is found. */
export function titleCaseSlug(slug: string): string {
  const words = slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ");
}

/** Metro slug → "Boise" (drops the trailing state for the compact header). */
export function metroLabelShort(slug: string): string {
  const name = METRO_NAME_BY_SLUG.get(slug.toLowerCase());
  return (name ?? titleCaseSlug(slug)).split(",")[0].trim();
}

const marketWord = (n: number) => `${n} market${n === 1 ? "" : "s"}`;

/**
 * The research's display title. `name` (Discovery.name) wins verbatim; else the
 * scope title from the resolved first-cell labels + cell count. Callers resolve
 * `firstCategory`/`firstMetro` however they like (DB label, slug title-case) and
 * this applies the same name-wins → single → multi rule everywhere.
 */
export function researchTitle(opts: {
  name?: string | null;
  cellCount: number;
  firstCategory?: string | null;
  firstMetro?: string | null;
}): string {
  const custom = opts.name?.trim();
  if (custom) return custom;
  const cat = opts.firstCategory?.trim() || "Research";
  if (opts.cellCount <= 1) {
    return opts.firstMetro ? `${cat} · ${opts.firstMetro}` : cat;
  }
  return `${cat} · ${marketWord(opts.cellCount)}`;
}

/**
 * A compact "which markets" summary for the workbench meta line — distinct
 * metros from the research's cell keys, first few shown + "+N more". Single cell
 * shows the full "Category · Metro". Null when there are no resolvable cells.
 */
export function marketsSummary(cellKeys: readonly string[]): string | null {
  if (cellKeys.length === 0) return null;
  if (cellKeys.length === 1) {
    const p = parseCellKey(cellKeys[0]);
    if (!p) return null;
    return `${titleCaseSlug(p.categorySlug)} · ${metroLabelShort(p.metroSlug)}`;
  }
  const metros: string[] = [];
  const seen = new Set<string>();
  for (const k of cellKeys) {
    const p = parseCellKey(k);
    if (!p) continue;
    const label = metroLabelShort(p.metroSlug);
    if (!seen.has(label)) {
      seen.add(label);
      metros.push(label);
    }
  }
  if (metros.length === 0) return marketWord(cellKeys.length);
  const shown = metros.slice(0, 3).join(" · ");
  const more = metros.length - 3;
  return more > 0 ? `${shown} +${more} more` : shown;
}
