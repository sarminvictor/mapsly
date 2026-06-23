// modules/playbooks/definitions/hvac.ts · the HVAC playbook (§4.15).
// Composes the shared ADA web-accessibility detector with three HVAC-specific
// detectors: a license-display gap, a "running ads with no conversion tracking"
// measurement gap, and a "no online booking" conversion gap. Adding a vertical
// = a file like this + a registry line — no pipeline change.

import { adaWebRisk } from "../signals/shared/ada";
import { hvacLicenseNumberAbsent } from "../signals/hvac/license-number-absent";
import { hvacNoConversionTracking } from "../signals/hvac/no-conversion-tracking";
import { hvacNoOnlineBooking } from "../signals/hvac/no-online-booking";
import type { CellPlaybook } from "../types";

export const hvacPlaybook: CellPlaybook = {
  id: "hvac",
  version: "1",
  categorySlugs: [
    "hvac",
    "hvac contractor",
    "heating contractor",
    "air conditioning contractor",
    "heating and air conditioning",
    "furnace repair service",
    "air conditioning repair service",
  ],
  regulations: [
    {
      name: "State contractor licensing (HVAC / mechanical)",
      scope: "state",
      summary:
        "Most states license HVAC/mechanical contractors and many require the license number on advertising and marketing materials.",
      citation: "https://www.contractors-license.org/",
    },
    {
      name: "EPA Section 608 technician certification",
      scope: "federal",
      summary:
        "Technicians handling refrigerants must hold EPA 608 certification; referencing it is a trust signal homeowners look for.",
      citation: "https://www.epa.gov/section608",
    },
    {
      name: "ADA Title III (web accessibility)",
      scope: "federal",
      summary:
        "Inaccessible websites draw serial demand letters; service businesses are common targets.",
      citation: "https://www.ada.gov/resources/web-guidance/",
    },
  ],
  signals: [
    adaWebRisk,
    hvacLicenseNumberAbsent,
    hvacNoConversionTracking,
    hvacNoOnlineBooking,
  ],
};
