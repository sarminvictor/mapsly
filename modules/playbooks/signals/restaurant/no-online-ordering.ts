/**
 * Restaurant · no online-ordering tool · detector
 *
 * Online ordering is table-stakes revenue for restaurants. A website-bearing
 * restaurant with NO e-commerce / online-ordering tool detected is leaving
 * direct revenue on the table — the plan tags this `high` because it's a
 * hard, money-on-the-table conversion gap with a clear retainer. We treat an
 * e-commerce OR payment tool as "can order online"; neither present ⇒ flagged.
 *
 * Hard-evidence note: the absence is a `dom_fingerprint` (machine-verifiable
 * "no ordering tag on the scanned site"), so this reaches `high`. Gated on the
 * tech enrichment — an unscanned site is "not checked", never "no ordering".
 *
 * See:
 *   - modules/playbooks/signals/shared/tech-presence.ts — hasEcommerceTool / hasPaymentTool
 */

import { assertExposurePhrasing } from "../../copy-lint";
import { hasEcommerceTool, hasPaymentTool } from "../shared/tech-presence";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const tech = ev.tech;
  if (!tech) return null;

  // An ordering / checkout surface present ⇒ nothing to flag.
  if (hasEcommerceTool(ev) || hasPaymentTool(ev)) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "dom_fingerprint",
      label: "Online-ordering tool",
      detail: `No e-commerce or payment/ordering tool detected across ${tech.length} detected ${
        tech.length === 1 ? "technology" : "technologies"
      }`,
      weight: 1,
    },
  ];

  const explanation = assertExposurePhrasing(
    `No online-ordering or checkout tool was detected on this restaurant's ` +
      `site — a potential direct-revenue gap worth checking, since online ` +
      `ordering is now a primary takeout channel.`,
  );

  return {
    value: "high",
    confidence: "high",
    evidence,
    explanation,
    // One hard dom_fingerprint absence; corroboration stays at 1 so the
    // confidence cap (high) is the ceiling but the evidence remains honest.
    corroborationCount: 1,
  };
}

export const restaurantNoOnlineOrdering: PlaybookSignal = {
  key: "restaurant.no_online_ordering",
  label: "No online-ordering tool",
  group: "conversion",
  requiresEnrichments: ["tech"],
  maxConfidence: "high",
  pitchAngle:
    "No way to order online — a direct online-ordering retainer angle (recovers commission paid to aggregators).",
  regulationRefs: [],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
