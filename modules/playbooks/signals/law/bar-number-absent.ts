/**
 * Law · attorney bar-number / licensure identifier absent from site · detector
 *
 * State bar advertising rules generally require lawyer advertising to identify a
 * responsible licensed attorney; many bars expect a bar number or an
 * identifiable admitted attorney on marketing materials. A law-firm site whose
 * listed services name no bar number and no attorney-identifier pattern is a
 * soft, exposure-worthy gap (a bar-advertising-compliance retainer angle), NOT
 * an accusation that the firm is unlicensed. Our only text surface is the
 * business's listed services, so this is an ABSENCE signal capped at `medium`.
 *
 * Absence contract (no-false-alarm):
 *   - No website ⇒ null (no "site" to check).
 *   - No services to scan ⇒ null ("not checked", never "absent").
 *   - A bar-number / "Esq." / "Attorney at Law" pattern present ⇒ null (found).
 *   - Otherwise ⇒ medium (single soft source).
 *
 * See:
 *   - modules/playbooks/copy-lint.ts — exposure framing
 *   - modules/playbooks/types.ts — PlaybookSignal contract
 */

import { assertExposurePhrasing } from "../../copy-lint";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

/**
 * A bar-number or admitted-attorney identifier in marketing text. Matches
 * "Bar No. 123456", "State Bar #987654", "Attorney No. 55-1234", "Jane Doe,
 * Esq.", "Attorney at Law". Conservative: the bar-number branch requires the
 * word "bar" (or "attorney no") adjacent to a number so a random phone never
 * trips it; the identifier branch requires an explicit lawyer honorific.
 */
export const BAR_IDENTIFIER_RE =
  /\b(?:(?:state\s+)?bar|attorney)\s*(?:no\.?|#|number)\s*[a-z]{0,4}-?\d{3,}|\besq\.?\b|\battorney at law\b/i;

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const services = ev.business.services;
  if (services.length === 0) return null;

  const found = services.some((s) => BAR_IDENTIFIER_RE.test(s.name));
  if (found) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "attribute",
      label: "Attorney identifier on site",
      detail: `No bar number or admitted-attorney identifier found across ${
        services.length
      } listed ${services.length === 1 ? "service" : "services"} on the site`,
      weight: 0.5,
    },
  ];

  const explanation = assertExposurePhrasing(
    `No bar number or identifiable admitted attorney appears in this law ` +
      `firm's listed services — a potential bar-advertising gap worth checking, ` +
      `since state bar rules generally require lawyer advertising to identify a ` +
      `responsible licensed attorney.`,
  );

  return {
    value: true,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const lawBarNumberAbsent: PlaybookSignal = {
  key: "law.bar_number_absent_from_site",
  label: "Attorney bar identifier absent from site",
  group: "compliance",
  requiresEnrichments: [],
  maxConfidence: "medium",
  pitchAngle:
    "Their site names no bar number or admitted attorney — a bar-advertising-compliance retainer angle.",
  regulationRefs: [
    "State bar attorney-advertising rules — advertising generally must identify a responsible licensed attorney",
  ],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
