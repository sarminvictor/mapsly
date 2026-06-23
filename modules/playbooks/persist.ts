// modules/playbooks/persist.ts · PlaybookSignalResult[] → PlaybookFinding rows
//
// The driver (./driver.ts) produces a pure PlaybookSignalResult per detector:
// either a verdict (status "flagged") or null + a notCheckedReason (status
// "not_checked"). This module upserts each into a PlaybookFinding row, keyed by
// the @@unique([businessId, signalKey]) so a re-run refreshes idempotently.
//
// We persist BOTH outcomes deliberately:
//   - "flagged"      a non-null verdict — carries value/confidence/evidence/
//                    explanation/pitchAngle (the evidence-mandatory invariant
//                    is already enforced by the driver).
//   - "not_checked"  a null result — carries notCheckedReason so the UI can
//                    say WHY a signal was not surfaced (never implying "clean"),
//                    per the product promise in ./types.ts.
//
// The playbook itself supplies per-signal metadata (group, pitchAngle) that the
// runtime verdict does not, so callers pass the CellPlaybook alongside results.
//
// See:
//   - prisma/schema.prisma            — model PlaybookFinding
//   - modules/playbooks/driver.ts     — PlaybookSignalResult / NotCheckedReason
//   - modules/playbooks/types.ts      — CellPlaybook / PlaybookSignal

import prisma, { Prisma } from "@/lib/prisma";

import type { PlaybookSignalResult } from "./driver";
import type { CellPlaybook, PlaybookSignal } from "./types";

/** PlaybookFinding.status literal union (kept local per conventions.md). */
export type FindingStatus = "flagged" | "not_checked";

/** Outcome of a persist run, for cron telemetry. */
export interface PersistOutcome {
  flagged: number;
  notChecked: number;
}

/** Index a playbook's signals by key for O(1) metadata lookup. */
function signalIndex(playbook: CellPlaybook): Map<string, PlaybookSignal> {
  const map = new Map<string, PlaybookSignal>();
  for (const s of playbook.signals) map.set(s.key, s);
  return map;
}

/** Coerce a verdict `value` (number | boolean | string) to a stored string. */
function valueToString(value: number | boolean | string): string {
  return typeof value === "string" ? value : String(value);
}

/**
 * Upsert one PlaybookFinding per result. Idempotent via the
 * @@unique([businessId, signalKey]) compound key — a re-run overwrites the
 * prior verdict for the same business+signal.
 *
 * `feedback` is intentionally NEVER written here — it is human-curated review
 * state (true-positive / false-positive) that must survive re-runs. The upsert
 * `update` clause omits it so a recompute does not clobber an analyst's mark.
 *
 * Returns counts of flagged vs not_checked rows for cron logging.
 */
export async function persistFindings(
  businessId: string,
  results: PlaybookSignalResult[],
  playbook: CellPlaybook,
): Promise<PersistOutcome> {
  const byKey = signalIndex(playbook);
  const playbookVersion = Number.parseInt(playbook.version, 10) || 1;

  let flagged = 0;
  let notChecked = 0;

  for (const result of results) {
    const signal = byKey.get(result.signalKey);
    // group/pitchAngle come from the signal definition; fall back defensively.
    const group = signal?.group ?? "unknown";
    const pitchAngle = signal?.pitchAngle ?? "";

    if (result.verdict) {
      flagged += 1;
      const v = result.verdict;
      const data = {
        playbookId: playbook.id,
        playbookVersion,
        group,
        value: valueToString(v.value),
        confidence: v.confidence,
        corroboration: v.corroborationCount,
        evidenceJson: v.evidence as unknown as Prisma.InputJsonValue,
        explanation: v.explanation,
        pitchAngle,
        status: "flagged" satisfies FindingStatus,
        notCheckedReason: null,
      };
      await prisma.playbookFinding.upsert({
        where: {
          businessId_signalKey: { businessId, signalKey: result.signalKey },
        },
        create: { businessId, signalKey: result.signalKey, ...data },
        update: data,
      });
    } else {
      notChecked += 1;
      const data = {
        playbookId: playbook.id,
        playbookVersion,
        group,
        value: "",
        confidence: "low",
        corroboration: 0,
        evidenceJson: Prisma.JsonNull,
        explanation: "",
        pitchAngle,
        status: "not_checked" satisfies FindingStatus,
        notCheckedReason: result.notCheckedReason ?? "no-finding",
      };
      await prisma.playbookFinding.upsert({
        where: {
          businessId_signalKey: { businessId, signalKey: result.signalKey },
        },
        create: { businessId, signalKey: result.signalKey, ...data },
        update: data,
      });
    }
  }

  return { flagged, notChecked };
}
