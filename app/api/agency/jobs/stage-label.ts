// stage-label.ts · PURE helper, deliberately separated from route.ts (which
// imports next-auth + prisma and can't be imported bare under Vitest).
//
// The Enriching checklist's "tech" row shares ONE display bucket for two
// distinct families that happen to feed the same visual stage:
//   - TECH (the DOM/CMS fingerprint) rides the CONTACTS fetch — it does NOT
//     produce its own EnrichmentJob rows (one scan does both, see
//     modules/enrichment/dispatch.ts buildJobPlan · the CONTACTS job is priced
//     for contacts+tech together).
//   - LIGHTHOUSE is a per-business EnrichmentJob family in its own right
//     (buildJobPlan pushes a LIGHTHOUSE job with its own rows / retry / cost).
// The label must name only what THIS run actually requested, never both by
// default: a Lighthouse-only run (e.g. the default Website-redesign goal, which
// only turns on `overdue_redesign` → lighthouse) must never say "Website & tech
// signals" — that implies a DOM/tech scan that never happened.

export function buildTechStageLabel(
  hasTech: boolean,
  hasLighthouse: boolean,
): string {
  if (hasTech && hasLighthouse) return "Website & tech signals + Lighthouse";
  if (hasTech) return "Website & tech signals";
  return "Site speed (Lighthouse)";
}
