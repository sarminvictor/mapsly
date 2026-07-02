/**
 * Roofing · state contractor license number absent from site · detector
 *
 * Most states license roofing contractors, and many require the license number
 * on advertising and marketing. A roofing site that names no license number
 * anywhere is a soft, exposure-worthy gap (a "license-display" retainer angle),
 * NOT an accusation the business is unlicensed. Our only text surface is the
 * business's listed services, so this is an ABSENCE signal capped at `medium`:
 * a license-number pattern never matching the named services.
 *
 * This mirrors the HVAC license-absent detector (same LICENSE_NUMBER_RE, same
 * absence contract) — roofing is a licensed trade with the same display norm.
 *
 * Absence contract (no-false-alarm):
 *   - No website ⇒ null (no "site" to check).
 *   - No services to scan ⇒ null ("not checked", never "absent").
 *   - A license-number pattern present in ANY service string ⇒ null (found one).
 *   - Otherwise ⇒ medium (single soft source).
 *
 * See:
 *   - modules/playbooks/signals/hvac/license-number-absent.ts — LICENSE_NUMBER_RE
 *   - modules/playbooks/copy-lint.ts — exposure framing
 */

import { assertExposurePhrasing } from "../../copy-lint";
import { LICENSE_NUMBER_RE } from "../hvac/license-number-absent";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const services = ev.business.services;
  if (services.length === 0) return null;

  const found = services.some((s) => LICENSE_NUMBER_RE.test(s.name));
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
    `No state contractor license number appears in this roofing business's ` +
      `listed services — a potential license-display gap worth checking, since ` +
      `most states expect a license number on contractor marketing.`,
  );

  return {
    value: true,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const roofingLicenseNumberAbsent: PlaybookSignal = {
  key: "roofing.license_number_absent_from_site",
  label: "Contractor license number absent from site",
  group: "compliance",
  requiresEnrichments: [],
  maxConfidence: "medium",
  pitchAngle:
    "Their site names no state roofing-contractor license number — a license-display retainer angle.",
  regulationRefs: [
    "State roofing/contractor licensing — many states require the license number on advertising/marketing",
  ],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
