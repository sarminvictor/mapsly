// modules/playbooks/definitions/restaurant.ts · the restaurant playbook (§4.15).
// Restaurants are the #1 ADA web-accessibility suit target, so the shared ADA
// detector is the headline. Composes it with two restaurant-specific detectors:
// a menu-allergen-disclosure gap and a no-online-ordering revenue gap.

import { adaWebRisk } from "../signals/shared/ada";
import { restaurantMenuNoAllergenInfo } from "../signals/restaurant/menu-no-allergen-info";
import { restaurantNoOnlineOrdering } from "../signals/restaurant/no-online-ordering";
import type { CellPlaybook } from "../types";

export const restaurantPlaybook: CellPlaybook = {
  id: "restaurant",
  version: "1",
  categorySlugs: [
    "restaurant",
    "cafe",
    "coffee shop",
    "bar",
    "pizza restaurant",
    "fast food restaurant",
    "fine dining restaurant",
    "diner",
  ],
  regulations: [
    {
      name: "ADA Title III (web accessibility)",
      scope: "federal",
      summary:
        "Restaurants are the single most common ADA web-accessibility demand-letter target; inaccessible online menus drive most suits.",
      citation: "https://www.ada.gov/resources/web-guidance/",
    },
    {
      name: "Allergen disclosure (CA SB-68 and similar)",
      scope: "state",
      summary:
        "A growing set of jurisdictions expect allergen / dietary information to be disclosed on menus.",
      citation: "https://leginfo.legislature.ca.gov/",
    },
    {
      name: "Health-inspection posting + alcohol license",
      scope: "state",
      summary:
        "Local health departments require inspection-grade posting; on-premise alcohol service requires a current license.",
      citation: "https://www.fda.gov/food/retail-food-protection",
    },
  ],
  signals: [
    adaWebRisk,
    restaurantMenuNoAllergenInfo,
    restaurantNoOnlineOrdering,
  ],
};
