// modules/playbooks/definitions/roofing.ts · the roofing playbook (WP6-11).
// Roofing/plumbing is a licensed trade with heavy storm-season paid spend, so
// the headline composite is "running ads with no conversion tracking" (high hit
// rate on seasonal advertisers). Composes that + the shared ADA detector with a
// roofing-specific license-display gap. Adding a vertical = a file like this +
// a registry line — no pipeline change.

import { adaWebRisk } from "../signals/shared/ada";
import { roofingLicenseNumberAbsent } from "../signals/roofing/license-number-absent";
import { roofingNoConversionTracking } from "../signals/roofing/no-conversion-tracking";
import type { CellPlaybook } from "../types";

export const roofingPlaybook: CellPlaybook = {
  id: "roofing",
  version: "1",
  categorySlugs: [
    "roofing",
    "roofing contractor",
    "roofer",
    "roof repair",
    "commercial roofing",
    "residential roofing",
    "plumbing",
    "plumber",
    "plumbing contractor",
  ],
  regulations: [
    {
      name: "State contractor licensing (roofing / plumbing)",
      scope: "state",
      summary:
        "Most states license roofing and plumbing contractors, and many require the license number on advertising and marketing materials.",
      citation: "https://www.contractors-license.org/",
    },
    {
      name: "State consumer-protection storm-chaser rules",
      scope: "state",
      summary:
        "Several states regulate post-storm roofing solicitation (contract-cancellation windows, insurance-proceeds disclosures) — a trust angle for reputable local shops.",
      citation:
        "https://www.iii.org/article/beware-of-storm-chasers-after-a-disaster",
    },
    {
      name: "ADA Title III (web accessibility)",
      scope: "federal",
      summary:
        "Inaccessible service-business websites draw serial demand letters; contractors are common targets.",
      citation: "https://www.ada.gov/resources/web-guidance/",
    },
  ],
  signals: [
    adaWebRisk,
    roofingLicenseNumberAbsent,
    roofingNoConversionTracking,
  ],
};
