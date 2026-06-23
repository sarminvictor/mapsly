/**
 * HIPAA tracking-pixel exposure on PHI pages · shared detector
 *
 * HHS guidance has held that third-party trackers (Meta Pixel, analytics) on
 * pages that handle protected health information (PHI) can disclose PHI to the
 * tracker vendor. The guidance is CONTESTED: in AHA v. HHS (2024) a federal
 * court vacated the part of the guidance covering unauthenticated public pages.
 * So this detector is exposure-framed AND confidence-capped at `medium` — we
 * never assert a HIPAA violation, only flag a co-location worth checking.
 *
 * Detection is a CO-LOCATION proxy (we cannot see page-level URLs here):
 *   tracker present  AND  a PHI surface (booking tool) present on the same site.
 *
 *   high   — a hard tracker (Meta Pixel / TikTok Pixel) AND a booking tool
 *            (corroboration = 2: pixel script + booking detection)
 *   medium — only GA4 alongside booking (analytics is softer than ad pixels)
 *   null   — no tracker, or no PHI surface, or no website ("not checked")
 *
 * See:
 *   - modules/playbooks/types.ts      — PlaybookSignal contract
 *   - modules/playbooks/confidence.ts — confidence cap rationale
 *   - modules/playbooks/copy-lint.ts  — exposure framing (no "violation")
 */

import { assertExposurePhrasing } from "../../copy-lint";
import type {
  EvidenceBundle,
  EvidenceItem,
  PlaybookSignal,
  SignalVerdict,
} from "../../types";

/**
 * Category slugs treated as health businesses that routinely handle PHI.
 * Lowercased; matched against business.categorySlugs.
 */
export const HIPAA_HEALTH_CATEGORIES: ReadonlySet<string> = new Set<string>([
  "med-spa",
  "dental",
  "medical clinic",
  "dermatology",
  "plastic surgery",
  "chiropractor",
  "physical therapy",
  "mental health",
  "urgent care",
  "veterinarian",
]);

/** Hard ad-pixel trackers — high-signal disclosure risk. */
const AD_PIXEL_NAMES = ["meta pixel", "tiktok pixel"];

/** Softer analytics tracker. */
const ANALYTICS_NAMES = ["ga4", "google analytics 4"];

/** True when any of the business's category slugs is a health category. */
function isHealthBusiness(ev: EvidenceBundle): boolean {
  return ev.business.categorySlugs.some((slug) =>
    HIPAA_HEALTH_CATEGORIES.has(slug.toLowerCase().trim()),
  );
}

/** Find a tech entry whose name matches (case-insensitive) any candidate. */
function findTech(
  tech: { name: string; category: string }[],
  candidates: string[],
): { name: string; category: string } | undefined {
  return tech.find((t) =>
    candidates.some((c) => t.name.toLowerCase().trim() === c),
  );
}

/** True when a booking tool (a PHI-collecting surface) is detected. */
function findBooking(
  tech: { name: string; category: string }[],
): { name: string; category: string } | undefined {
  return tech.find((t) => t.category.toLowerCase().includes("booking"));
}

function detect(ev: EvidenceBundle): SignalVerdict | null {
  const tech = ev.tech;
  if (!tech) return null; // enrichment not run

  const adPixel = findTech(tech, AD_PIXEL_NAMES);
  const analytics = findTech(tech, ANALYTICS_NAMES);
  const booking = findBooking(tech);

  // PHI surface required: a booking tool stands in for "a page that collects
  // patient info". No booking → no co-location to flag → not checked.
  if (!booking) return null;

  // No tracker at all → not checked.
  if (!adPixel && !analytics) return null;

  const evidence: EvidenceItem[] = [];

  // Booking surface is always part of the co-location evidence.
  evidence.push({
    kind: "detected_script",
    label: "Booking / intake tool",
    detail: `${booking.name} detected (collects patient information)`,
    weight: 0.7,
  });

  let value: string;
  let confidence: "high" | "medium" | "low";
  let corroborationCount: number;

  if (adPixel) {
    // Hard ad-pixel + PHI surface → highest co-location signal.
    evidence.push({
      kind: "detected_script",
      label: "Advertising tracker",
      detail: `${adPixel.name} detected (transmits page activity to ${adPixel.name.split(" ")[0]})`,
      weight: 1,
    });
    value = "high";
    confidence = "high";
    corroborationCount = 2; // pixel script + booking detection
  } else {
    // analytics only → softer.
    evidence.push({
      kind: "detected_script",
      label: "Analytics tracker",
      detail: `${analytics!.name} detected (transmits page activity to Google)`,
      weight: 0.6,
    });
    value = "medium";
    confidence = "medium";
    corroborationCount = 2;
  }

  const trackerName = adPixel ? adPixel.name : analytics!.name;
  const explanation = assertExposurePhrasing(
    `A ${trackerName} tracker runs on a site that also collects patient ` +
      `information through ${booking.name} — a potential patient-privacy ` +
      `exposure worth checking, since trackers on health pages can transmit ` +
      `details to third parties. Note: HHS tracking guidance is contested ` +
      `after AHA v. HHS, so this flags a review point rather than a conclusion.`,
  );

  return {
    value,
    confidence,
    evidence,
    explanation,
    corroborationCount,
  };
}

/**
 * The HIPAA tracking-pixel-on-PHI-page exposure detector. Pure; reads tech
 * fingerprints + category slugs from the bundle. Confidence-capped at high but
 * the copy hedges given the contested regulatory status.
 */
export const hipaaPixelOnPhiPage: PlaybookSignal = {
  key: "hipaa-pixel-on-phi-page",
  label: "Tracking pixel on patient-data pages",
  group: "privacy",
  requiresEnrichments: ["tech"],
  maxConfidence: "high",
  pitchAngle:
    "An ad/analytics tracker shares a site with their patient-intake forms.",
  regulationRefs: [
    "HHS Bulletin: Use of Online Tracking Technologies by HIPAA Covered Entities (CONTESTED)",
    "AHA v. HHS (2024) — vacated tracking guidance for unauthenticated public pages",
  ],
  falsePositiveGuards: [
    // Not a health business → out of scope → not checked.
    (ev: EvidenceBundle) => ({
      tripped: !isHealthBusiness(ev),
      reason: "not-a-health-business",
    }),
    // No website → nothing to fingerprint → not checked.
    (ev: EvidenceBundle) => ({
      tripped: ev.business.website === null,
      reason: "no-website",
    }),
  ],
  detect,
};
