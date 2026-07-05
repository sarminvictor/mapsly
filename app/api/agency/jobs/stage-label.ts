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

/** One candidate display stage of the Enriching step's checklist. */
export interface StageDef {
  key: string;
  label: string;
  families: string[];
}

/**
 * The candidate display stages, each mapped to the EnrichmentFamily values that
 * feed it. buildEnrichStages (route.ts) emits ONLY the subset this run actually
 * performs. The per-business EnrichmentJob families (see
 * modules/enrichment/dispatch.ts buildJobPlan) are
 * CONTACTS / SERVICES / REVIEWS / LIGHTHOUSE / AI_RESEARCH — each fans out its
 * own rows. TECH has no rows of its own: it rides the CONTACTS fetch (one scan
 * does both). Only the per-CELL families (serp / ads / meta) and the post-close
 * PLAYBOOK layer have no per-business job rows and fall back to the run
 * lifecycle for their stage status.
 *
 * "Draft first touches" is DELIBERATELY NOT a stage here — first-touch drafts
 * are a separate Touchpoints action, never part of an enrichment run. Kept in a
 * bare (prisma-free) module so the honesty invariant is unit-testable.
 */
export const STAGE_DEFS: readonly StageDef[] = [
  // The free discovery step — labelled so it reads as the free "find the
  // market" pass, never a paid research the user was charged for.
  { key: "mapped", label: "Find businesses · free", families: [] },
  { key: "contacts", label: "Contacts extracted", families: ["CONTACTS"] },
  {
    // Label is a fallback only — the "tech" stage's REAL label is computed
    // per-run in route.ts (buildTechStageLabel), since "tech" and "lighthouse"
    // are two independent families that happen to share one display bucket. A
    // Lighthouse-only run (e.g. the default Website-redesign goal) must never
    // say "Website & tech signals" — that implies a DOM/tech scan that didn't
    // run (see INC: Enriching checklist overclaimed families for that goal).
    key: "tech",
    label: "Site speed & tech signals",
    families: ["TECH", "LIGHTHOUSE"],
  },
  {
    key: "reviews",
    label: "Reviews & reputation signals",
    families: ["REVIEWS"],
  },
  {
    key: "expert",
    label: "Expert layer (playbook)",
    families: ["AI_RESEARCH", "PLAYBOOK"],
  },
] as const;
