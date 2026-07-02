// modules/playbooks/definitions/law.ts · the law-firm playbook (WP6-11).
// Attorney advertising is heavily regulated by state bar rules, so the headline
// composites are two bar-advertising gaps: no identifiable bar number / admitted
// attorney, and no advertising disclaimer. Composes those + the shared ADA
// detector. Adding a vertical = a file like this + a registry line — no pipeline
// change.

import { adaWebRisk } from "../signals/shared/ada";
import { lawBarNumberAbsent } from "../signals/law/bar-number-absent";
import { lawAdvertisingDisclaimerAbsent } from "../signals/law/advertising-disclaimer-absent";
import type { CellPlaybook } from "../types";

export const lawPlaybook: CellPlaybook = {
  id: "law",
  version: "1",
  categorySlugs: [
    "law",
    "law firm",
    "lawyer",
    "attorney",
    "legal services",
    "personal injury attorney",
    "family law attorney",
    "criminal justice attorney",
    "estate planning attorney",
    "divorce lawyer",
  ],
  regulations: [
    {
      name: "State bar attorney-advertising rules",
      scope: "state",
      summary:
        "State bars regulate lawyer advertising — most require advertising to identify a responsible licensed attorney, and many require a disclaimer / 'prior results' language where results or testimonials appear.",
      citation:
        "https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_7_2_communications_concerning_a_lawyer_s_services_specific_rules/",
    },
    {
      name: "ADA Title III (web accessibility)",
      scope: "federal",
      summary:
        "Inaccessible law-firm websites draw serial demand letters; consumer-facing legal sites are frequent targets.",
      citation: "https://www.ada.gov/resources/web-guidance/",
    },
  ],
  signals: [adaWebRisk, lawBarNumberAbsent, lawAdvertisingDisclaimerAbsent],
};
