// modules/playbooks/definitions/chiropractic.ts · the chiropractic playbook
// (WP6-11). Chiropractors are healthcare providers (HIPAA covered entities that
// often run tracking pixels alongside intake/booking) subject to health-claim
// advertising rules. The headline composites are the shared HIPAA pixel-on-PHI
// detector + a chiro-specific unsubstantiated-health-claim detector, plus the
// shared ADA detector. Adding a vertical = a file like this + a registry line —
// no pipeline change.

import { adaWebRisk } from "../signals/shared/ada";
import { hipaaPixelOnPhiPage } from "../signals/shared/hipaa";
import { chiroUnsubstantiatedHealthClaim } from "../signals/chiropractic/unsubstantiated-health-claim";
import type { CellPlaybook } from "../types";

export const chiropracticPlaybook: CellPlaybook = {
  id: "chiropractic",
  version: "1",
  categorySlugs: [
    "chiropractic",
    "chiropractor",
    "chiropractic clinic",
    "chiropractic care",
    "sports chiropractor",
    "wellness chiropractor",
  ],
  regulations: [
    {
      name: "HIPAA Online Tracking (OCR)",
      scope: "federal",
      summary:
        "Chiropractic clinics are HIPAA covered entities. Tracking pixels on pages that handle patient data may expose PHI. The federal theory is contested post AHA v. HHS (2024).",
      citation:
        "https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/hipaa-online-tracking/index.html",
      contested: true,
    },
    {
      name: "State chiropractic-board advertising + FTC health claims",
      scope: "state",
      summary:
        "Chiropractic boards and the FTC restrict absolute health-outcome claims ('cures', 'treats <disease>') to those with competent, reliable scientific substantiation.",
      citation:
        "https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance",
    },
    {
      name: "ADA Title III (web accessibility)",
      scope: "federal",
      summary:
        "Inaccessible health/wellness sites are frequent ADA demand-letter targets.",
      citation: "https://www.ada.gov/resources/web-guidance/",
    },
  ],
  signals: [hipaaPixelOnPhiPage, adaWebRisk, chiroUnsubstantiatedHealthClaim],
};
