/**
 * Dental · unverified specialist / board-certified claim · detector
 *
 * State dental-board advertising rules restrict who may call themselves a
 * "specialist" or "board-certified" — generally only those holding the matching
 * recognized specialty credential. A site that ASSERTS such a claim while we
 * hold NO matching license record is a soft, exposure-worthy review point (a
 * dental-board-ad-rules retainer angle), NOT an accusation. We read the claim
 * deterministically from the service text (a `nano_reading` over the strings we
 * already store — no live AI here) and pair it with the license-absence.
 *
 * Capped at `medium` (the plan tags this `med, nano+license`): the claim is a
 * soft `nano_reading` and the license check is a stub today, so we never reach
 * `high`.
 *
 * Absence/claim contract (no-false-alarm):
 *   - No services to read ⇒ null ("not checked").
 *   - No specialist/board-certified claim in the text ⇒ null (nothing asserted).
 *   - A claim AND a matching license-number pattern in the text ⇒ null (the
 *     claim is corroborated; absence disproven).
 *   - A claim with NO matching license ⇒ medium.
 *
 * See:
 *   - modules/playbooks/signals/hvac/license-number-absent.ts — LICENSE_NUMBER_RE
 *   - modules/playbooks/types.ts — EvidenceKind "nano_reading"
 */

import { assertExposurePhrasing } from "../../copy-lint";
import { LICENSE_NUMBER_RE } from "../hvac/license-number-absent";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

/** A specialist / board-certified style claim in marketing text. */
export const SPECIALIST_CLAIM_RE =
  /\b(board[\s-]?certified|specialist|orthodontist|periodontist|endodontist|prosthodontist|oral surgeon)\b/i;

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const services = ev.business.services;
  if (services.length === 0) return null;

  const claimed = services.find((s) => SPECIALIST_CLAIM_RE.test(s.name));
  // No specialist claim asserted ⇒ nothing to verify ⇒ no finding.
  if (!claimed) return null;

  // A license number is named in the text ⇒ the claim is corroborated.
  const hasLicense = services.some((s) => LICENSE_NUMBER_RE.test(s.name));
  if (hasLicense) return null;

  const match = claimed.name.match(SPECIALIST_CLAIM_RE);
  const phrase = match ? match[0] : "specialist";

  const evidence: EvidenceItem[] = [
    {
      kind: "nano_reading",
      label: "Specialty claim",
      detail: `"${phrase}" claimed in service "${
        claimed.name.length > 80
          ? `${claimed.name.slice(0, 77)}…`
          : claimed.name
      }"`,
      weight: 0.5,
    },
    {
      kind: "attribute",
      label: "Matching license",
      detail: "No matching license number found alongside the specialty claim",
      weight: 0.4,
    },
  ];

  const explanation = assertExposurePhrasing(
    `This dental site claims "${phrase}" but we found no matching license ` +
      `number to corroborate it — a potential dental-board advertising-rule ` +
      `exposure worth checking, since several states restrict specialty claims ` +
      `to credential-holders.`,
  );

  return {
    value: phrase,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const dentalSpecialistClaimUnverified: PlaybookSignal = {
  key: "dental.specialist_claim_unverified",
  label: "Unverified specialist / board-certified claim",
  group: "compliance",
  requiresEnrichments: [],
  maxConfidence: "medium",
  pitchAngle:
    "They advertise a specialist claim we can't verify — a dental-board ad-rules retainer angle.",
  regulationRefs: [
    "State dental-board advertising rules — specialty / 'specialist' claims generally restricted to credential-holders",
  ],
  falsePositiveGuards: [
    // No website → claims unlikely to be the live marketing surface → skip.
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
