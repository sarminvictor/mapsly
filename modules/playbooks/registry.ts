// modules/playbooks/registry.ts · the playbook registry (Phase 7). Resolves a
// business category to its CellPlaybook. Launch set = 5 verticals, all wired:
// med-spa, HVAC, dental, restaurant, auto-body (each a definitions/*.ts file).

import { medSpaPlaybook } from "./definitions/med-spa";
import { hvacPlaybook } from "./definitions/hvac";
import { dentalPlaybook } from "./definitions/dental";
import { restaurantPlaybook } from "./definitions/restaurant";
import { autoBodyPlaybook } from "./definitions/auto-body";
import type { CellPlaybook } from "./types";

export const ALL_PLAYBOOKS: readonly CellPlaybook[] = [
  medSpaPlaybook,
  hvacPlaybook,
  dentalPlaybook,
  restaurantPlaybook,
  autoBodyPlaybook,
];

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
