/**
 * HVAC · state contractor license number absent from site · detector
 *
 * Most states require an HVAC/mechanical contractor to carry — and many require
 * them to DISPLAY — a state license number. A site that names no license number
 * anywhere is a soft, exposure-worthy gap (a prospect filter for "license
 * display" retainers), NOT an accusation that the business is unlicensed. We can
 * only read the SERVICE TEXT here (the bundle has no raw page HTML), so this is
 * an ABSENCE signal capped at `medium`: a license-number regex never matching
 * the named services / website-bearing business.
 *
 * Absence-based contract (no-false-alarm rules):
 *   - We need a website to even have a "site" to check → no website ⇒ null.
 *   - We need at least one service name to scan (our only text surface) → no
 *     services ⇒ null ("not checked", never "absent").
 *   - A license-number pattern present in ANY service string ⇒ null (we found
 *     one; absence is disproven).
 *   - Otherwise ⇒ medium (the plan tags this `med`). Single soft source.
 *
 * See:
 *   - modules/playbooks/types.ts      — PlaybookSignal contract
 *   - modules/playbooks/copy-lint.ts  — exposure framing
 *   - .claude/rules/signal-engineering.md
 */

import { assertExposurePhrasing } from "../../copy-lint";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

/**
 * A license-number mention. Matches "license #12345", "lic. no. AB-1234",
 * "CSLB 123456", "state lic 99887". Conservative: requires the word lic(ense)
 * (or a known board acronym) adjacent to a number so a random phone/zip never
 * trips it.
 */
export const LICENSE_NUMBER_RE =
  /\b(?:lic(?:ense)?\.?|cslb|epa|reg(?:istration)?\.?)\s*(?:no\.?|#|number)?\s*[a-z]{0,4}-?\d{3,}/i;

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const services = ev.business.services;
  // Our only text surface is the service list; nothing to scan ⇒ not checked.
  if (services.length === 0) return null;

  const found = services.some((s) => LICENSE_NUMBER_RE.test(s.name));
  // A license number IS named somewhere ⇒ absence disproven ⇒ no finding.
  if (found) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "attribute",
      label: "License number on site",
      detail: `No license-number pattern found across ${services.length} listed ${
        services.length === 1 ? "service" : "services"
      } on the site`,
      weight: 0.5,
    },
  ];

  const explanation = assertExposurePhrasing(
    `No state contractor license number appears in this HVAC business's listed ` +
      `services — a potential license-display gap worth checking, since most ` +
      `states expect a license number on contractor marketing.`,
  );

  return {
    value: true,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const hvacLicenseNumberAbsent: PlaybookSignal = {
  key: "hvac.license_number_absent_from_site",
  label: "Contractor license number absent from site",
  group: "compliance",
  requiresEnrichments: [],
  maxConfidence: "medium",
  pitchAngle:
    "Their site names no state contractor license number — a license-display retainer angle.",
  regulationRefs: [
    "State HVAC/mechanical contractor licensing — many states require the license number on advertising/marketing",
  ],
  falsePositiveGuards: [
    // No website → no "site" to check → not checked (absence ≠ evidence).
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
