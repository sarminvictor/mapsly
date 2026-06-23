/**
 * Auto-body · no I-CAR / OEM certification displayed · detector
 *
 * Collision-repair buyers (and insurers) trust I-CAR Gold Class and OEM
 * certifications. A shop that displays none in its marketing text is leaving a
 * trust + ranking lever unused — a soft "surface your certifications" angle, NOT
 * a compliance accusation. The plan tags this `low`: it's a `nano_reading` over
 * the service text with no hard corroboration, so it caps at low.
 *
 * Absence contract:
 *   - No services to read ⇒ null ("not checked").
 *   - Any I-CAR / Gold Class / OEM-certified language present ⇒ null (displayed).
 *   - Otherwise ⇒ low.
 *
 * See:
 *   - modules/playbooks/types.ts — EvidenceKind "nano_reading"
 */

import { assertExposurePhrasing } from "../../copy-lint";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

/** I-CAR / Gold Class / OEM-certified trust language. */
export const ICAR_OEM_RE =
  /\b(i[\s-]?car|gold\s*class|oem[\s-]?certified|oem\s*certification|ase[\s-]?certified|manufacturer[\s-]?certified)\b/i;

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const services = ev.business.services;
  if (services.length === 0) return null;

  const displayed = services.some((s) => ICAR_OEM_RE.test(s.name));
  if (displayed) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "nano_reading",
      label: "Certification language",
      detail: `No I-CAR / Gold Class / OEM-certified language found across ${services.length} listed ${
        services.length === 1 ? "service" : "services"
      }`,
      weight: 0.3,
    },
  ];

  const explanation = assertExposurePhrasing(
    `This auto-body site displays no I-CAR, Gold Class or OEM certification ` +
      `language — a potential trust-signal gap worth reviewing, since these ` +
      `certifications reassure buyers and insurers.`,
  );

  return {
    value: true,
    confidence: "low",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const autoBodyNoIcarOemCert: PlaybookSignal = {
  key: "auto_body.no_icar_oem_cert_displayed",
  label: "No I-CAR / OEM certification displayed",
  group: "reputation",
  requiresEnrichments: [],
  maxConfidence: "low",
  pitchAngle:
    "No I-CAR / OEM certification surfaced — a trust-signal / conversion-copy angle.",
  regulationRefs: [],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
