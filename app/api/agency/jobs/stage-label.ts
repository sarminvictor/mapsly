// stage-label.ts · PURE helper, deliberately separated from route.ts (which
// imports next-auth + prisma and can't be imported bare under Vitest).
//
// The Enriching checklist's "tech" row shares ONE display bucket for two
// independent families — the DOM/tech (CMS) fingerprint and the Lighthouse
// site-speed audit — because neither produces its own EnrichmentJob rows (both
// run inline per-cell). The label must name only what THIS run actually
// requested, never both by default: a Lighthouse-only run (e.g. the default
// Website-redesign goal, which only turns on `overdue_redesign` → lighthouse)
// must never say "Website & tech signals" — that implies a DOM/tech scan that
// never happened.

export function buildTechStageLabel(
  hasTech: boolean,
  hasLighthouse: boolean,
): string {
  if (hasTech && hasLighthouse) return "Website & tech signals + Lighthouse";
  if (hasTech) return "Website & tech signals";
  return "Site speed (Lighthouse)";
}
