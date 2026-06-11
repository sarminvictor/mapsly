/** Business qualification · public API. */

export {
  scrapeEmailsFromWebsite,
  buildCandidate,
  type EmailCandidate,
  type EmailScrapeSource,
  type ScrapeResult,
} from "./scrape-email";

export { rdapLookup, type RdapResult } from "./rdap";

export {
  qualifyBusiness,
  qualifyCell,
  recomputeCellAggregates,
  type QualifyOutcome,
  type CellQualifyResult,
  type QualificationStatusValue,
} from "./qualify";

export {
  verifyAndPromoteCellEmails,
  type VerifyPromoteResult,
} from "./verify-promote";
