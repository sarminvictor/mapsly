// modules/playbooks/registry.ts · the playbook registry (Phase 7). Resolves a
// business category to its CellPlaybook. Verticals wired (each a definitions/*.ts
// file): med-spa, HVAC, dental, restaurant, auto-body (Phase 7) + roofing/
// plumbing, law, chiropractic (WP6-11). Adding a vertical = a new definitions
// file + one import + one array line — no pipeline change.

import { medSpaPlaybook } from "./definitions/med-spa";
import { hvacPlaybook } from "./definitions/hvac";
import { dentalPlaybook } from "./definitions/dental";
import { restaurantPlaybook } from "./definitions/restaurant";
import { autoBodyPlaybook } from "./definitions/auto-body";
import { roofingPlaybook } from "./definitions/roofing";
import { lawPlaybook } from "./definitions/law";
import { chiropracticPlaybook } from "./definitions/chiropractic";
import { assertSignalCopy } from "./copy-lint";
import type { CellPlaybook } from "./types";

export const ALL_PLAYBOOKS: readonly CellPlaybook[] = [
  medSpaPlaybook,
  hvacPlaybook,
  dentalPlaybook,
  restaurantPlaybook,
  autoBodyPlaybook,
  roofingPlaybook,
  lawPlaybook,
  chiropracticPlaybook,
];

// WP7-3 · defamation-phrasing constitution, enforced at module load. Every
// registered signal's STATIC copy (its `label` + `pitchAngle`, which render on
// the SHARED Proof Pack / share page / CSV export) must be exposure-framed —
// the same guard the dynamic `explanation` already runs at detect-time. A
// detector whose headline copy asserts a violation throws here on import, so it
// can never reach a shared artifact. (The registry-wide test covers this too;
// the runtime sweep makes it a hard guarantee, not just a CI check.)
for (const pb of ALL_PLAYBOOKS) {
  for (const signal of pb.signals) assertSignalCopy(signal);
}

/** Resolve a category slug (case-insensitive) to its playbook, or null. */
export function playbookForCategory(categorySlug: string): CellPlaybook | null {
  const norm = categorySlug.toLowerCase().trim();
  return (
    ALL_PLAYBOOKS.find((p) =>
      p.categorySlugs.some((c) => c.toLowerCase() === norm),
    ) ?? null
  );
}

/** First matching playbook across a business's primary + secondary categories. */
export function playbookForBusiness(
  categorySlugs: string[],
): CellPlaybook | null {
  for (const slug of categorySlugs) {
    const pb = playbookForCategory(slug);
    if (pb) return pb;
  }
  return null;
}
