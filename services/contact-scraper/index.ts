// services/contact-scraper · public surface.
//
// The PARSER side of the scrape split: pure functions over a rendered DOM (the
// HTML the dom-fetcher actor returns). Extract contacts, classify reachability,
// and filter website-vendor / no-reply emails. No network, no Prisma — these
// run on our backend over already-fetched bytes (the "fetch once, parse many"
// principle).
//
// The fetch side lives in services/dom-fetcher; the orchestrator that wires
// both to the DB is modules/discovery/enrich-contacts.ts.

export {
  parseContacts,
  type ParsedContact,
  type ParseContactsInput,
  type ContactChannel,
  type ContactRole,
  type ContactSource,
} from "./parse";

export {
  computeReachability,
  type ReachabilityResult,
  type ReachabilityStatus,
} from "./reachability";

export { isVendorEmail } from "./vendor-domains";
