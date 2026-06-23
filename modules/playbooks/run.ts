// modules/playbooks/run.ts · the per-business expert-layer pipeline (Phase 7)
//
// Ties the four pure/IO pieces together for one business:
//
//   1. resolve   — playbookForBusiness(categorySlugs) picks the CellPlaybook for
//                  the business's vertical (or null → no-op, this vertical has
//                  no playbook yet).
//   2. hydrate   — hydrateEvidenceBundle(businessId) loads the inert bundle.
//   3. detect    — runPlaybook(playbook, bundle) runs every pure detector
//                  through the safety driver (enrichment gates, FP guards,
//                  evidence-mandatory, confidence cap).
//   4. persist   — persistFindings writes a PlaybookFinding row per signal
//                  (flagged | not_checked), idempotent on [businessId,signalKey].
//
// Returns the PlaybookSignalResult[] (verdicts + not-checked reasons) so the
// caller (cron / on-demand action) can log + revalidate. A business whose
// category has no playbook returns an empty array and writes nothing.
//
// No AI here — the whole pipeline is deterministic. (gpt-5.4-nano never touches
// the expert layer; verdicts must be evidence-backed rules.)
//
// See:
//   - modules/playbooks/registry.ts — playbookForBusiness
//   - modules/playbooks/hydrate.ts  — hydrateEvidenceBundle
//   - modules/playbooks/driver.ts   — runPlaybook
//   - modules/playbooks/persist.ts  — persistFindings

import prisma from "@/lib/prisma";

import { runPlaybook } from "./driver";
import { hydrateEvidenceBundle } from "./hydrate";
import { persistFindings, type PersistOutcome } from "./persist";
import { playbookForBusiness } from "./registry";

import type { PlaybookSignalResult } from "./driver";

/** Result of one business run. `playbookId` is null when no playbook applies. */
export interface RunPlaybooksResult {
  businessId: string;
  playbookId: string | null;
  results: PlaybookSignalResult[];
  persisted: PersistOutcome | null;
}

/**
 * Resolve a business's category slugs the same way hydrate does (primary +
 * additional + DfS slugs, lowercased + de-duped) so we can pick its playbook
 * BEFORE the (more expensive) full hydrate.
 */
async function categorySlugsFor(businessId: string): Promise<string[]> {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { category: true, categories: true, categoryIds: true },
  });
  if (!biz) return [];
  return Array.from(
    new Set(
      [biz.category, ...biz.categories, ...biz.categoryIds]
        .filter((c): c is string => typeof c === "string" && c.length > 0)
        .map((c) => c.toLowerCase().trim()),
    ),
  );
}

/**
 * Run the expert layer for one business. No-op (empty results, nothing
 * persisted) when the business's vertical has no playbook.
 */
export async function runPlaybooksForBusiness(
  businessId: string,
): Promise<RunPlaybooksResult> {
  const slugs = await categorySlugsFor(businessId);
  const playbook = playbookForBusiness(slugs);

  if (!playbook) {
    return { businessId, playbookId: null, results: [], persisted: null };
  }

  const bundle = await hydrateEvidenceBundle(businessId);
  const results = runPlaybook(playbook, bundle);
  const persisted = await persistFindings(businessId, results, playbook);

  return { businessId, playbookId: playbook.id, results, persisted };
}
