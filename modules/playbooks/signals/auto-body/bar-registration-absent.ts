/**
 * Auto-body · shop registration (BAR) number absent · detector
 *
 * Auto-body / collision-repair shops are registered with the state (e.g. the
 * California Bureau of Automotive Repair, "BAR") and the registration number is
 * commonly expected on the shop's marketing. A site naming no shop-registration
 * number is a soft license-display gap (a registration-display retainer angle),
 * NOT an accusation that the shop is unregistered. Absence-based, capped at
 * `medium` per the plan.
 *
 * Absence contract:
 *   - No services to scan (our text surface) ⇒ null ("not checked").
 *   - A registration-number pattern present in the text ⇒ null (found one).
 *   - Otherwise ⇒ medium.
 *
 * See:
 *   - modules/playbooks/signals/hvac/license-number-absent.ts — LICENSE_NUMBER_RE
 */

import { assertExposurePhrasing } from "../../copy-lint";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

/**
 * A shop-registration / BAR number mention. Accepts "BAR #123456",
 * "registration no. 998877", "ARD 12345" (auto repair dealer). Requires the
 * registration cue adjacent to a number so a phone/zip never trips it.
 */
export const BAR_REGISTRATION_RE =
  /\b(?:bar|ard|reg(?:istration)?\.?|shop\s*(?:lic(?:ense)?\.?|reg\.?))\s*(?:no\.?|#|number)?\s*[a-z]?-?\d{3,}/i;

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const services = ev.business.services;
  if (services.length === 0) return null;

  const found = services.some((s) => BAR_REGISTRATION_RE.test(s.name));
  if (found) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "attribute",
      label: "Shop registration number",
      detail: `No shop-registration (BAR) number found across ${services.length} listed ${
        services.length === 1 ? "service" : "services"
      } on the site`,
      weight: 0.5,
    },
  ];

  const explanation = assertExposurePhrasing(
    `No shop-registration number appears in this auto-body business's listed ` +
      `services — a potential registration-display gap worth checking, since ` +
      `states like California expect a BAR registration number on shop marketing.`,
  );

  return {
    value: true,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const autoBodyBarRegistrationAbsent: PlaybookSignal = {
  key: "auto_body.bar_registration_absent",
  label: "Shop registration (BAR) number absent",
  group: "compliance",
  requiresEnrichments: [],
  maxConfidence: "medium",
  pitchAngle:
    "No state shop-registration number on the site — a registration-display retainer angle.",
  regulationRefs: [
    "State auto-repair shop registration (e.g. CA Bureau of Automotive Repair) — registration number commonly expected on marketing",
  ],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
