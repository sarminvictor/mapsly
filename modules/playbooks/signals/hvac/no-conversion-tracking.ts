/**
 * HVAC · running ads with no conversion tracking · detector
 *
 * The plan's highest-value HVAC angle: a business that is clearly RUNNING ADS
 * (an ad-platform tag is on the site) but has NO conversion tracking (no pixel
 * AND no analytics) is burning ad spend blind — a strong, hard-evidence pitch
 * for a measurement retainer. This is the rare HVAC signal that can reach
 * `high`, because both halves are hard `detected_script` artifacts.
 *
 * "Running ads" proxy (pure, over the tech fingerprint we already store): an
 * ad-platform TAG is present — a Google Ads / Google Tag Manager / Meta tag the
 * fingerprinter records by NAME — yet NO conversion-measuring category (pixel or
 * analytics) is detected. A site that has a real pixel/analytics is measuring,
 * so it is excluded (no finding). Absence of the ad tag ⇒ we cannot assert "they
 * advertise", so we return null ("not checked"), never a false alarm.
 *
 * Tiers:
 *   high — an ad-platform tag detected AND zero conversion tracking
 *          (2 hard artifacts: the tag presence + the tracking absence).
 *   null — no ad-platform tag (can't prove they advertise), OR conversion
 *          tracking IS present (nothing to fix).
 *
 * See:
 *   - modules/playbooks/signals/shared/ad-tags.ts — AD_TAG_NAMES / findAdTag
 *   - modules/playbooks/signals/shared/tech-presence.ts — hasConversionTracking
 *   - modules/playbooks/confidence.ts — hard-evidence tiering
 */

import { assertExposurePhrasing } from "../../copy-lint";
import { findAdTag } from "../shared/ad-tags";
import { hasConversionTracking } from "../shared/tech-presence";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const tech = ev.tech;
  if (!tech) return null; // gated by requiresEnrichments, stay defensive

  const adTag = findAdTag(tech);
  // No evidence they advertise ⇒ we cannot claim wasted spend ⇒ not checked.
  if (!adTag) return null;

  // They ARE measuring conversions ⇒ nothing to fix ⇒ no finding.
  if (hasConversionTracking(ev)) return null;

  const evidence: EvidenceItem[] = [
    {
      kind: "detected_script",
      label: "Ad-platform tag",
      detail: `${adTag.name} detected (the business is running paid ads)`,
      weight: 1,
    },
    {
      kind: "dom_fingerprint",
      label: "Conversion tracking",
      detail: "No conversion pixel or analytics tag detected alongside the ads",
      weight: 1,
    },
  ];

  const explanation = assertExposurePhrasing(
    `An ad-platform tag (${adTag.name}) runs on this site but no conversion ` +
      `pixel or analytics was detected — a potential measurement gap worth ` +
      `checking, since ad spend without tracking can't be attributed to jobs ` +
      `booked.`,
  );

  return {
    value: "high",
    confidence: "high",
    evidence,
    explanation,
    corroborationCount: 2,
  };
}

export const hvacNoConversionTracking: PlaybookSignal = {
  key: "hvac.no_conversion_tracking",
  label: "Running ads with no conversion tracking",
  group: "advertising",
  requiresEnrichments: ["tech"],
  maxConfidence: "high",
  pitchAngle:
    "They run ads but track no conversions — a measurement / attribution retainer angle.",
  regulationRefs: [],
  falsePositiveGuards: [
    // No website → nothing to fingerprint → not checked.
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
