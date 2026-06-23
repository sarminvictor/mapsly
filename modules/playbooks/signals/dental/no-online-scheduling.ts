/**
 * Dental · no online-scheduling tool · detector
 *
 * New-patient acquisition for dental practices leans heavily on online booking.
 * A website-bearing practice with NO scheduling/booking tool detected is a soft
 * conversion gap (an online-scheduling retainer angle), NOT a compliance issue.
 * Absence-based, capped at `medium`, gated on the tech enrichment so an unscanned
 * site is "not checked", never "no booking".
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

  if (hasBookingTool(ev)) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "dom_fingerprint",
      label: "Online scheduling tool",
      detail: `No scheduling/booking tool detected across ${tech.length} detected ${
        tech.length === 1 ? "technology" : "technologies"
      }`,
      weight: 0.6,
    },
  ];

  const explanation = assertExposurePhrasing(
    `No online-scheduling tool was detected on this dental site — a potential ` +
      `new-patient conversion gap worth checking, since most patients now book ` +
      `appointments online.`,
  );

  return {
    value: true,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const dentalNoOnlineScheduling: PlaybookSignal = {
  key: "dental.no_online_scheduling",
  label: "No online-scheduling tool",
  group: "conversion",
  requiresEnrichments: ["tech"],
  maxConfidence: "medium",
  pitchAngle:
    "No way to book appointments online — an online-scheduling retainer angle.",
  regulationRefs: [],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
