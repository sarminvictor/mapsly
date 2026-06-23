/**
 * ADA web-accessibility exposure · shared detector
 *
 * Title III of the ADA has been read to cover business websites; serial
 * demand letters and lawsuits target sites failing well-known WCAG checks.
 * Lighthouse surfaces those checks as discrete audits, so we can detect
 * EXPOSURE deterministically from the audit set — no live calls, no AI.
 *
 * We weigh SERIOUS audits (the ones that block a screen-reader / keyboard
 * user outright):
 *   image-alt · label · link-name · button-name · color-contrast · meta-viewport
 *
 * MODERATE audits (tap-targets, document-title, html-has-lang) are noted as
 * corroboration but NEVER raise risk on their own — they are real WCAG checks
 * but rarely the basis of a demand letter, so a moderate-only site is "low"
 * at most and usually null.
 *
 * Tiers (serious audits failing / total failing nodes across them):
 *   high   — ≥3 serious audits failing  AND  ≥25 total failing nodes
 *   medium — ≥2 serious audits          OR   10–24 total failing nodes
 *   low    — exactly 1 serious audit with <10 nodes
 *   null   — 0 serious failures ("not a finding"; never "accessible")
 *
 * See:
 *   - modules/playbooks/types.ts      — PlaybookSignal contract
 *   - modules/playbooks/copy-lint.ts  — exposure framing
 *   - .claude/rules/accessibility.md  — WCAG 2.1 AA reference
 */

import { assertExposurePhrasing } from "../../copy-lint";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

/**
 * Lighthouse audit ids treated as SERIOUS for ADA exposure, mapped to a
 * human label for the evidence item.
 */
export const ADA_SERIOUS_AUDITS: Record<string, string> = {
  "image-alt": "Image alt text",
  label: "Form field labels",
  "link-name": "Discernible link names",
  "button-name": "Discernible button names",
  "color-contrast": "Color contrast",
  "meta-viewport": "Zoom / viewport scaling",
};

/**
 * Moderate audits: recorded as soft corroboration, never sole basis of risk.
 */
export const ADA_MODERATE_AUDITS: Record<string, string> = {
  "tap-targets": "Tap target size",
  "document-title": "Document title",
  "html-has-lang": "Page language declared",
};

/** A Lighthouse audit with score < 1 (or null) is considered failing. */
function isFailing(audit: { score: number | null } | undefined): boolean {
  if (!audit) return false;
  return audit.score === null || audit.score < 1;
}

/** Failing-node count for an audit, defaulting to 1 when not reported. */
function failingNodeCount(audit: { failingNodes?: number }): number {
  return typeof audit.failingNodes === "number" && audit.failingNodes > 0
    ? audit.failingNodes
    : 1;
}

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const audits = ev.lighthouseAudits;
  // requiresEnrichments guards this in the driver, but stay defensive.
  if (!audits) return null;

  const evidence: EvidenceItem[] = [];
  let seriousCount = 0;
  let totalSeriousNodes = 0;

  for (const [auditId, label] of Object.entries(ADA_SERIOUS_AUDITS)) {
    const audit = audits[auditId];
    if (!isFailing(audit)) continue;
    const nodes = failingNodeCount(audit!);
    seriousCount += 1;
    totalSeriousNodes += nodes;
    evidence.push({
      kind: "failing_audit",
      label,
      detail: `${nodes} failing ${nodes === 1 ? "node" : "nodes"} (Lighthouse "${auditId}")`,
      weight: 1,
    });
  }

  // 0 serious failures → "not a finding", never "accessible".
  if (seriousCount === 0) return null;

  // Soft corroboration from moderate audits (does not gate risk).
  let moderateCount = 0;
  for (const [auditId, label] of Object.entries(ADA_MODERATE_AUDITS)) {
    const audit = audits[auditId];
    if (!isFailing(audit)) continue;
    moderateCount += 1;
    evidence.push({
      kind: "failing_audit",
      label,
      detail: `${failingNodeCount(audit!)} failing (Lighthouse "${auditId}", moderate)`,
      weight: 0.3,
    });
  }

  // Risk tiering driven SOLELY by serious audits + their node count.
  let value: string;
  let confidence: "high" | "medium" | "low";
  if (seriousCount >= 3 && totalSeriousNodes >= 25) {
    // high — broad serious failure AND a large affected-element count.
    value = "high";
    confidence = "high";
  } else if (
    seriousCount >= 2 ||
    (totalSeriousNodes >= 10 && totalSeriousNodes <= 24)
  ) {
    // medium — 2+ serious audits (any node count short of the high gate), or a
    // single audit with a meaningful 10–24 affected elements.
    value = "medium";
    confidence = "medium";
  } else {
    // low — exactly 1 serious audit with <10 nodes (the only remaining case).
    value = "low";
    confidence = "low";
  }

  // corroboration = independent serious audits + whether moderate audits agree.
  const corroborationCount = seriousCount + (moderateCount > 0 ? 1 : 0);

  const explanation = assertExposurePhrasing(
    `This site shows ${seriousCount} accessibility ` +
      `${seriousCount === 1 ? "check" : "checks"} failing ` +
      `(${totalSeriousNodes} affected ${totalSeriousNodes === 1 ? "element" : "elements"}) — ` +
      `a potential ADA web-accessibility exposure worth reviewing, since these ` +
      `are the checks commonly cited in accessibility demand letters.`,
  );

  return {
    value,
    confidence,
    evidence,
    explanation,
    corroborationCount,
  };
}

/**
 * The ADA web-accessibility exposure detector. Pure; reads only Lighthouse
 * audits from the bundle.
 */
export const adaWebRisk: PlaybookSignal = {
  key: "ada-web-risk",
  label: "ADA web-accessibility exposure",
  group: "accessibility",
  requiresEnrichments: ["lighthouseAudits"],
  maxConfidence: "high",
  pitchAngle:
    "Their site fails the accessibility checks that drive ADA demand letters.",
  regulationRefs: [
    "ADA Title III — public-accommodation access; applied to commercial websites in serial demand letters and litigation",
    "WCAG 2.1 AA — the de-facto standard courts reference",
  ],
  falsePositiveGuards: [
    // No website → nothing to audit → not checked.
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
