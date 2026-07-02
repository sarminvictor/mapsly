/**
 * Law · attorney-advertising disclaimer absent from site · detector
 *
 * Many state bar rules require lawyer advertising to carry a disclaimer —
 * commonly an "Attorney Advertising" label and/or a "prior results do not
 * guarantee a similar outcome" line where past results or testimonials are
 * shown. A law-firm site whose listed services carry no such disclaimer
 * language is a soft, exposure-worthy gap (a bar-advertising-compliance
 * retainer angle), NOT an accusation. Our only text surface is the listed
 * services, so this is an ABSENCE signal capped at `medium`.
 *
 * Absence contract (no-false-alarm):
 *   - No website ⇒ null (no "site" to check).
 *   - No services to scan ⇒ null ("not checked", never "absent").
 *   - Any disclaimer-language pattern present ⇒ null (found; absence disproven).
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
 * Disclaimer language a compliant lawyer-advertising surface commonly carries.
 * Matches "Attorney Advertising", "prior results", "past results", "no
 * guarantee of a similar outcome", "this is an advertisement". Case-insensitive.
 */
export const AD_DISCLAIMER_RE =
  /\battorney advertising\b|\b(?:prior|past) results\b|\bno guarantee of a? ?similar outcome\b|\bthis is an advertisement\b|\battorney-client relationship\b/i;

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const services = ev.business.services;
  if (services.length === 0) return null;

  const found = services.some((s) => AD_DISCLAIMER_RE.test(s.name));
  if (found) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "attribute",
      label: "Advertising disclaimer on site",
      detail: `No attorney-advertising disclaimer language found across ${
        services.length
      } listed ${services.length === 1 ? "service" : "services"} on the site`,
      weight: 0.5,
    },
  ];

  const explanation = assertExposurePhrasing(
    `No attorney-advertising disclaimer language appears in this law firm's ` +
      `listed services — a potential bar-advertising gap worth checking, since ` +
      `many state bars expect a disclaimer where results or testimonials are ` +
      `shown.`,
  );

  return {
    value: true,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const lawAdvertisingDisclaimerAbsent: PlaybookSignal = {
  key: "law.advertising_disclaimer_absent",
  label: "Attorney-advertising disclaimer absent from site",
  group: "compliance",
  requiresEnrichments: [],
  maxConfidence: "medium",
  pitchAngle:
    "Their site carries no attorney-advertising disclaimer — a bar-advertising-compliance retainer angle.",
  regulationRefs: [
    "State bar attorney-advertising rules — many require an advertising disclaimer / 'prior results' language",
  ],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
