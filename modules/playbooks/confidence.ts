/**
 * Confidence tiering · the "NEVER an unverified accusation" math
 *
 * Confidence is derived deterministically from the evidence backing a verdict,
 * then capped by the detector's declared maximum. The tiers:
 *
 *   high   — ≥2 independent evidence KINDS  AND  ≥1 HARD artifact
 *   medium — exactly one hard artifact (corroboration thin)
 *   low    — only soft signals, or a lone nano_reading
 *
 * HARD artifacts are machine-verifiable observations:
 *   detected_script · failing_audit · license_lookup · dom_fingerprint
 *
 * Everything else (review_quote, ad_creative, cell_percentile, attribute,
 * nano_reading) is SOFT — it corroborates but never raises a verdict to `high`
 * on its own.
 *
 * See:
 *   - modules/playbooks/types.ts       — Confidence / EvidenceItem / EvidenceKind
 *   - .claude/rules/signal-engineering.md
 */

import type { Confidence, EvidenceItem, EvidenceKind } from "./types";

/**
 * Evidence kinds that count as HARD (machine-verifiable) artifacts. A `high`
 * verdict requires at least one of these.
 */
export const HARD_EVIDENCE_KINDS: ReadonlySet<EvidenceKind> =
  new Set<EvidenceKind>([
    "detected_script",
    "failing_audit",
    "license_lookup",
    "dom_fingerprint",
  ]);

/** True when the item is a hard, machine-verifiable artifact. */
export function isHardEvidence(item: EvidenceItem): boolean {
  return HARD_EVIDENCE_KINDS.has(item.kind);
}

/**
 * Derive a confidence tier purely from the evidence set + corroboration count.
 *
 * @param evidence            the verdict's evidence items
 * @param corroborationCount  independent-source count the detector reported
 */
export function tierFromEvidence(
  evidence: EvidenceItem[],
  corroborationCount: number,
): Confidence {
  if (evidence.length === 0) return "low";

  const distinctKinds = new Set<EvidenceKind>(evidence.map((e) => e.kind));
  const hardCount = evidence.filter(isHardEvidence).length;
  const hasHard = hardCount >= 1;

  // high — multiple independent kinds AND at least one hard artifact AND the
  // detector saw real corroboration. corroborationCount >= 2 keeps a single
  // source from inflating to high even if it tagged two evidence items.
  if (distinctKinds.size >= 2 && hasHard && corroborationCount >= 2) {
    return "high";
  }

  // medium — a single hard artifact (e.g. one failing audit, one detected
  // script) with thin corroboration.
  if (hasHard) {
    return "medium";
  }

  // low — soft-only. A nano_reading on its own, or any single soft signal.
  return "low";
}

/** Numeric ordering for confidence so we can take the lower of two. */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Return the lower (more conservative) of the computed confidence and the
 * detector's declared maximum. This is how a detector says "I can never be
 * more than `medium` sure" (e.g. contested regulations).
 */
export function capConfidence(
  computed: Confidence,
  max: Confidence,
): Confidence {
  return CONFIDENCE_RANK[computed] <= CONFIDENCE_RANK[max] ? computed : max;
}
