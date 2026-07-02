/**
 * Chiropractic · unsubstantiated health / efficacy claim · detector
 *
 * State chiropractic boards and the FTC restrict health-outcome advertising:
 * absolute efficacy claims ("cures", "eliminates", "treats <disease>") generally
 * require competent, reliable scientific substantiation. A chiropractic site
 * whose listed services assert an absolute cure/treatment claim is a soft,
 * exposure-worthy review point (a health-claim-advertising retainer angle), NOT
 * an accusation. We read the claim deterministically from the service text (a
 * `nano_reading` over strings we already store — no live AI). Capped at
 * `medium`: it is a soft text read.
 *
 * Claim contract (no-false-alarm):
 *   - No website ⇒ null (claims unlikely to be the live marketing surface).
 *   - No services to read ⇒ null ("not checked").
 *   - No absolute claim phrase in the text ⇒ null (nothing asserted).
 *   - An absolute claim phrase present ⇒ medium.
 *
 * See:
 *   - modules/playbooks/copy-lint.ts — exposure framing
 *   - modules/playbooks/types.ts — EvidenceKind "nano_reading"
 */

import { assertExposurePhrasing } from "../../copy-lint";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

/**
 * Absolute health-outcome claim language chiropractic boards / the FTC treat as
 * requiring substantiation. Matches "cure(s) <x>", "cures for", "eliminate(s)
 * <disease>", "treats <named condition>", "reverses", "guaranteed relief",
 * "100% (effective|natural cure)". Conservative: requires an absolute-outcome
 * verb, not a generic "helps with" wellness phrase.
 */
export const HEALTH_CLAIM_RE =
  /\bcure(?:s|d)?\b|\beliminate(?:s|d)?\b|\breverse(?:s|d)?\b|\bguaranteed (?:relief|results|cure)\b|\b100%\s*(?:effective|natural cure|cure)\b|\btreats?\s+(?:cancer|asthma|adhd|autism|diabetes|infertility|colic|ear infections?)\b/i;

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const services = ev.business.services;
  if (services.length === 0) return null;

  const claimed = services.find((s) => HEALTH_CLAIM_RE.test(s.name));
  if (!claimed) return null;

  const match = claimed.name.match(HEALTH_CLAIM_RE);
  const phrase = match ? match[0] : "cure";

  const evidence: EvidenceItem[] = [
    {
      kind: "nano_reading",
      label: "Health-outcome claim",
      detail: `"${phrase}" claimed in service "${
        claimed.name.length > 80
          ? `${claimed.name.slice(0, 77)}…`
          : claimed.name
      }"`,
      weight: 0.5,
    },
  ];

  const explanation = assertExposurePhrasing(
    `This chiropractic site advertises an absolute health-outcome claim ` +
      `("${phrase}") — a potential health-claim-advertising exposure worth ` +
      `checking, since chiropractic boards and the FTC generally require ` +
      `substantiation for absolute efficacy claims.`,
  );

  return {
    value: phrase,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const chiroUnsubstantiatedHealthClaim: PlaybookSignal = {
  key: "chiropractic.unsubstantiated_health_claim",
  label: "Unsubstantiated health / efficacy claim",
  group: "compliance",
  requiresEnrichments: [],
  maxConfidence: "medium",
  pitchAngle:
    "They advertise an absolute health-outcome claim that may need substantiation — a health-claim-advertising retainer angle.",
  regulationRefs: [
    "State chiropractic-board advertising rules + FTC health-claim substantiation — absolute efficacy claims generally require competent, reliable scientific evidence",
  ],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
