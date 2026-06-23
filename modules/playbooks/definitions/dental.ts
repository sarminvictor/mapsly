// modules/playbooks/definitions/dental.ts · the dental playbook (§4.15).
// Dental practices are HIPAA covered entities, so the shared HIPAA pixel-on-PHI
// composite is the headline (high hit rate). Composes that + the shared ADA
// detector with two dental-specific detectors: an unverified specialist claim
// (dental-board ad rules) and a no-online-scheduling conversion gap.

import { adaWebRisk } from "../signals/shared/ada";
import { hipaaPixelOnPhiPage } from "../signals/shared/hipaa";
import { dentalSpecialistClaimUnverified } from "../signals/dental/specialist-claim-unverified";
import { dentalNoOnlineScheduling } from "../signals/dental/no-online-scheduling";
import type { CellPlaybook } from "../types";

export const dentalPlaybook: CellPlaybook = {
  id: "dental",
  version: "1",
  categorySlugs: [
    "dental",
    "dentist",
    "dental clinic",
    "dental office",
    "cosmetic dentist",
    "pediatric dentist",
    "orthodontist",
  ],
  regulations: [
    {
      name: "HIPAA Online Tracking (OCR)",
      scope: "federal",
      summary:
        "Dental practices are HIPAA covered entities. Tracking pixels on pages that handle patient data may expose PHI. The federal theory is contested post AHA v. HHS (2024).",
      citation:
        "https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/hipaa-online-tracking/index.html",
      contested: true,
    },
    {
      name: "State dental-board advertising rules",
      scope: "state",
      summary:
        "State dental boards restrict 'specialist' / 'board-certified' advertising claims to those holding the recognized specialty credential.",
      citation: "https://www.ada.org/resources/practice/dental-practice-laws",
    },
    {
      name: "ADA Title III (web accessibility)",
      scope: "federal",
      summary:
        "Inaccessible health/beauty sites are frequent ADA demand-letter targets.",
      citation: "https://www.ada.gov/resources/web-guidance/",
    },
  ],
  signals: [
    hipaaPixelOnPhiPage,
    adaWebRisk,
    dentalSpecialistClaimUnverified,
    dentalNoOnlineScheduling,
  ],
};
