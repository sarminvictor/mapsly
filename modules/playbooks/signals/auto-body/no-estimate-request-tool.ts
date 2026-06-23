/**
 * Auto-body · no estimate-request tool · detector
 *
 * Collision-repair customers want to request an estimate online (photo upload /
 * form / scheduler). A website-bearing shop with NO booking/scheduling tool
 * detected has no online estimate-request path — a soft conversion gap (an
 * "add online estimate request" retainer angle), NOT a compliance issue.
 * Absence-based, capped at `medium`, gated on the tech enrichment so an
 * unscanned site is "not checked", never "no estimate tool".
 *
 * A booking/scheduling tool is our deterministic proxy for an estimate-request
 * surface (the fingerprinter records these as the BOOKING category).
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

  // A booking/scheduling surface present ⇒ estimate request is possible.
  if (hasBookingTool(ev)) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "dom_fingerprint",
      label: "Online estimate-request tool",
      detail: `No booking/scheduling (estimate-request) tool detected across ${tech.length} detected ${
        tech.length === 1 ? "technology" : "technologies"
      }`,
      weight: 0.6,
    },
  ];

  const explanation = assertExposurePhrasing(
    `No online estimate-request tool was detected on this auto-body site — a ` +
      `potential conversion gap worth checking, since customers increasingly ` +
      `request collision estimates online.`,
  );

  return {
    value: true,
    confidence: "medium",
    evidence,
    explanation,
    corroborationCount: 1,
  };
}

export const autoBodyNoEstimateRequestTool: PlaybookSignal = {
  key: "auto_body.no_estimate_request_tool",
  label: "No estimate-request tool",
  group: "conversion",
  requiresEnrichments: ["tech"],
  maxConfidence: "medium",
  pitchAngle:
    "No way to request an estimate online — an estimate-request-form retainer angle.",
  regulationRefs: [],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
