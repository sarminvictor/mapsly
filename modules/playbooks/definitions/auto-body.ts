// modules/playbooks/definitions/auto-body.ts · the auto-body playbook (§4.15).
// Composes the shared ADA web-accessibility detector with three auto-body-
// specific detectors: a state shop-registration (BAR) display gap, a missing
// I-CAR / OEM certification trust signal, and a no-estimate-request conversion
// gap.

import { adaWebRisk } from "../signals/shared/ada";
import { autoBodyBarRegistrationAbsent } from "../signals/auto-body/bar-registration-absent";
import { autoBodyNoIcarOemCert } from "../signals/auto-body/no-icar-oem-cert-displayed";
import { autoBodyNoEstimateRequestTool } from "../signals/auto-body/no-estimate-request-tool";
import type { CellPlaybook } from "../types";

export const autoBodyPlaybook: CellPlaybook = {
  id: "auto-body",
  version: "1",
  categorySlugs: [
    "auto-body",
    "auto body shop",
    "auto body",
    "body shop",
    "collision repair",
    "collision repair service",
    "auto repair shop",
    "car repair",
  ],
  regulations: [
    {
      name: "State auto-repair shop registration (e.g. CA BAR)",
      scope: "state",
      summary:
        "Auto-repair / body shops register with the state (e.g. the California Bureau of Automotive Repair); the registration number is commonly expected on shop marketing.",
      citation: "https://www.bar.ca.gov/",
    },
    {
      name: "EPA refinish NESHAP + VOC limits",
      scope: "federal",
      summary:
        "Collision-refinishing operations are subject to EPA Area Source NESHAP (6H) and VOC limits on coatings.",
      citation:
        "https://www.epa.gov/stationary-sources-air-pollution/national-emission-standards-hazardous-air-pollutants-neshap-9",
    },
    {
      name: "ADA Title III (web accessibility)",
      scope: "federal",
      summary:
        "Inaccessible service-business websites draw serial demand letters.",
      citation: "https://www.ada.gov/resources/web-guidance/",
    },
  ],
  signals: [
    adaWebRisk,
    autoBodyBarRegistrationAbsent,
    autoBodyNoIcarOemCert,
    autoBodyNoEstimateRequestTool,
  ],
};
