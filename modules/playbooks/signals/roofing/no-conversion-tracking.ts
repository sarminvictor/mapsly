/**
 * Roofing · running ads with no conversion tracking · detector
 *
 * Roofers spend heavily on storm-season paid search + social. A roofing site
 * that is clearly RUNNING ADS (an ad-platform tag is on the site) but has NO
 * conversion tracking (no pixel AND no analytics) is burning ad spend blind —
 * a strong, hard-evidence pitch for a measurement retainer. Both halves are
 * hard `detected_script` / `dom_fingerprint` artifacts, so this can reach
 * `high`.
 *
 * "Running ads" proxy (pure, over the tech fingerprint we already store): an
 * ad-platform TAG is present (Google Ads / GTM / Meta) yet NO conversion-
 * measuring category (pixel or analytics) is detected. A site that has a real
 * pixel/analytics is measuring, so it is excluded (no finding). Absence of the
 * ad tag ⇒ null ("not checked"), never a false alarm.
 *
 * Reuses the shared AD_TAG_NAMES matcher + hasConversionTracking predicate so
 * the "runs ads" and "measures" definitions stay in one place.
 *
 * See:
 *   - modules/playbooks/signals/shared/ad-tags.ts — AD_TAG_NAMES / findAdTag
 *   - modules/playbooks/signals/shared/tech-presence.ts — hasConversionTracking
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
  if (!tech) return null;

  const adTag = findAdTag(tech);
  if (!adTag) return null; // no evidence they advertise ⇒ not checked

  if (hasConversionTracking(ev)) return null; // measuring ⇒ nothing to fix

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
    `An ad-platform tag (${adTag.name}) runs on this roofing site but no ` +
      `conversion pixel or analytics was detected — a potential measurement gap ` +
      `worth checking, since storm-season ad spend without tracking can't be ` +
      `attributed to jobs booked.`,
  );

  return {
    value: "high",
    confidence: "high",
    evidence,
    explanation,
    corroborationCount: 2,
  };
}

export const roofingNoConversionTracking: PlaybookSignal = {
  key: "roofing.no_conversion_tracking",
  label: "Running ads with no conversion tracking",
  group: "advertising",
  requiresEnrichments: ["tech"],
  maxConfidence: "high",
  pitchAngle:
    "They run storm-season ads but track no conversions — a measurement / attribution retainer angle.",
  regulationRefs: [],
  falsePositiveGuards: [
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
