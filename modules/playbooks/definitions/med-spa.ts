// modules/playbooks/definitions/med-spa.ts · the flagship launch playbook.
// Composes the cross-vertical detectors (HIPAA pixel exposure, ADA web risk)
// with a med-spa-specific reputation detector. Adding a vertical = a new file
// like this + a registry line (see ../registry.ts) — no pipeline change.

import { adaWebRisk } from "../signals/shared/ada";
import { hipaaPixelOnPhiPage } from "../signals/shared/hipaa";
import { medspaReviewComplaintCluster } from "../signals/medspa/review-complaint-cluster";
import type { CellPlaybook } from "../types";

export const medSpaPlaybook: CellPlaybook = {
  id: "med-spa",
  version: "1",
  categorySlugs: [
    "med-spa",
    "medical_spa",
    "medical spa",
    "med spa",
    "medspa",
    "aesthetics clinic",
    "skin care clinic",
  ],
  regulations: [
    {
      name: "HIPAA Online Tracking (OCR)",
      scope: "federal",
      summary:
        "Tracking pixels on pages that handle patient data may expose PHI. Class-action / state-privacy exposure is real; the federal theory is contested post AHA v. HHS (2024).",
      citation:
        "https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/hipaa-online-tracking/index.html",
      contested: true,
    },
    {
      name: "Medical-director / physician-supervision disclosure",
      scope: "state",
      summary:
        "Several states require med-spas offering injectables to disclose a supervising physician / medical director on-site and online.",
      citation: "https://www.americanmedspa.org/page/state-laws",
    },
    {
      name: "ADA Title III (web accessibility)",
      scope: "federal",
      summary:
        "Inaccessible websites draw thousands of ADA suits/year; restaurants + health/beauty are frequent targets.",
      citation: "https://www.ada.gov/resources/web-guidance/",
    },
  ],
  signals: [hipaaPixelOnPhiPage, adaWebRisk, medspaReviewComplaintCluster],
};
