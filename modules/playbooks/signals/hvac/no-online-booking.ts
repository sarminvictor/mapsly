/**
 * HVAC · no online-booking tool · detector
 *
 * Homeowners increasingly expect to book service online. A site with a working
 * website but NO booking/scheduling tool detected is a soft conversion gap — a
 * "add online booking" retainer angle, NOT a compliance accusation. Absence-
 * based and capped at `medium`.
 *
 * Absence contract:
 *   - requiresEnrichments ["tech"] → the driver returns null when tech was
 *     never fingerprinted (so "no booking tool" can't be falsely asserted on an
 *     unscanned site).
 *   - A booking tool present ⇒ no finding.
 *   - No booking tool on a website-bearing business ⇒ medium.
 *
 * See:
 *   - modules/playbooks/signals/shared/tech-presence.ts — hasBookingTool
 */

import { assertExposurePhrasing } from "../../copy-lint";
import { hasBookingTool } from "../shared/tech-presence";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const tech = ev.tech;
  if (!tech) return null;

  // A booking tool IS present ⇒ nothing to flag.
  if (hasBookingTool(ev)) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "dom_fingerprint",
      label: "Online booking tool",
      detail: `No scheduling/booking tool detected across ${tech.length} detected ${
        tech.length === 1 ? "technology" : "technologies"
      }`,
      weight: 0.6,
    },
  ];

  const explanation = assertExposurePhrasing(
    `No online-booking tool was detected on this HVAC site — a potential ` +
      `conversion gap worth checking, since homeowners increasingly expect to ` +
      `request service online.`,
  );

  return {
    value: true,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const hvacNoOnlineBooking: PlaybookSignal = {
  key: "hvac.no_online_booking",
  label: "No online-booking tool",
  group: "conversion",
  requiresEnrichments: ["tech"],
  maxConfidence: "medium",
  pitchAngle:
    "No way to book service online — an online-booking retainer angle.",
  regulationRefs: [],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
