/**
 * Playbook driver · the runner that enforces the safety invariants
 *
 * Detectors are PURE rules but they are NOT trusted to police themselves. The
 * driver is the single chokepoint that enforces the product promise before any
 * verdict reaches the UI:
 *
 *   1. requiresEnrichments — if any required enrichment is null/missing on the
 *      bundle, the signal is "not checked" (null), NEVER "clean".
 *   2. falsePositiveGuards — if any guard trips, the signal is "not checked".
 *   3. try/catch — a throwing detector degrades to null, never crashes a page.
 *   4. evidence-mandatory — a non-null verdict with no evidence is a defect;
 *      throws in dev so tests catch it, returns null in prod (fail-closed).
 *   5. capConfidence — the emitted confidence is capped by maxConfidence.
 *
 * See:
 *   - modules/playbooks/types.ts       — PlaybookSignal / SignalVerdict
 *   - modules/playbooks/confidence.ts  — capConfidence
 *   - .claude/rules/validation-and-errors.md — fail-closed, log not throw in prod
 */

import { capConfidence } from "./confidence";
import type {
  CellPlaybook,
  EnrichmentKey,
  EvidenceBundle,
  PlaybookSignal,
  SignalVerdict,
} from "./types";

/** True in non-production so the evidence-mandatory invariant throws in tests. */
function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Check whether a required enrichment is present (non-null) on the bundle.
 * `reviews` is always an array (never null), so it is considered present.
 */
function hasEnrichment(ev: EvidenceBundle, key: EnrichmentKey): boolean {
  switch (key) {
    case "tech":
      return ev.tech !== null;
    case "lighthouseAudits":
      return ev.lighthouseAudits !== null;
    case "reviews":
      return ev.reviews !== null && ev.reviews !== undefined;
    default:
      return false;
  }
}

/** Reason codes for why a signal was not checked. */
export type NotCheckedReason =
  | `missing-enrichment:${string}`
  | `guard-tripped:${string}`
  | "detector-threw"
  | "no-finding"
  | "evidence-missing";

/**
 * Run a single detector through the safety pipeline.
 *
 * Returns null ("not checked" / "no finding") when:
 *   - a required enrichment is missing,
 *   - any false-positive guard trips,
 *   - the detector throws,
 *   - the detector returns null (genuinely nothing to report),
 *   - or the detector returns a verdict with zero evidence (fail-closed).
 *
 * In dev, the evidence-mandatory violation throws so tests catch the defect.
 */
export function runSignal(
  signal: PlaybookSignal,
  ev: EvidenceBundle,
): SignalVerdict | null {
  // 1 · required enrichments must all be present
  for (const key of signal.requiresEnrichments) {
    if (!hasEnrichment(ev, key)) return null;
  }

  // 2 · any tripped guard short-circuits to "not checked"
  for (const guard of signal.falsePositiveGuards) {
    let result: { tripped: boolean; reason: string };
    try {
      result = guard(ev);
    } catch {
      // A throwing guard is itself a false-positive risk → fail closed.
      return null;
    }
    if (result.tripped) return null;
  }

  // 3 · run the detector defensively
  let verdict: SignalVerdict | null;
  try {
    verdict = signal.detect(ev);
  } catch {
    return null;
  }

  if (verdict === null) return null;

  // 4 · evidence-mandatory invariant
  if (!verdict.evidence || verdict.evidence.length === 0) {
    if (isDev()) {
      throw new Error(
        `Playbook signal "${signal.key}" emitted a non-null verdict with no ` +
          `evidence. Every verdict MUST carry ≥1 EvidenceItem ` +
          `(evidence-mandatory invariant).`,
      );
    }
    return null;
  }

  // 5 · cap confidence at the detector's declared maximum
  return {
    ...verdict,
    confidence: capConfidence(verdict.confidence, signal.maxConfidence),
  };
}

/** One row of a playbook run: the signal key, its verdict (or null), why. */
export interface PlaybookSignalResult {
  signalKey: string;
  verdict: SignalVerdict | null;
  notCheckedReason?: NotCheckedReason;
}

/**
 * Compute the not-checked reason for a null result so the UI can say WHY a
 * signal wasn't surfaced (never implying "clean"). Mirrors the runSignal gates.
 */
function diagnoseNull(
  signal: PlaybookSignal,
  ev: EvidenceBundle,
): NotCheckedReason {
  for (const key of signal.requiresEnrichments) {
    if (!hasEnrichment(ev, key)) return `missing-enrichment:${key}`;
  }
  for (const guard of signal.falsePositiveGuards) {
    try {
      const r = guard(ev);
      if (r.tripped) return `guard-tripped:${r.reason}`;
    } catch {
      return "detector-threw";
    }
  }
  return "no-finding";
}

/**
 * Run every detector in a playbook against one bundle, returning a result row
 * per signal (verdict or null + reason).
 */
export function runPlaybook(
  playbook: CellPlaybook,
  ev: EvidenceBundle,
): PlaybookSignalResult[] {
  return playbook.signals.map((signal) => {
    const verdict = runSignal(signal, ev);
    if (verdict !== null) {
      return { signalKey: signal.key, verdict };
    }
    return {
      signalKey: signal.key,
      verdict: null,
      notCheckedReason: diagnoseNull(signal, ev),
    };
  });
}
