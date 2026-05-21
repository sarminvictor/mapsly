// services/lighthouse · public surface.
//
// Mapsly's Lighthouse audit pipeline. Two layers:
//
//   - `services/dataforseo/lighthouse` (Phase C.3) provides the raw DataForSEO
//     Lighthouse call — Google Lighthouse v10 JSON for any URL.
//   - This module (Phase C.5) wraps that with custom DOM checks (schema.org,
//     NAP consistency, above-the-fold phone + booking CTA) so a single
//     `lighthouseFullAudit({ url, nap })` call returns everything we
//     persist to `LighthouseAudit`.
//
// Use in cron handlers (weekly:lighthouse-audit) inside `withCronRun`:
//
//   import { lighthouseFullAudit, toPersistRow } from "@/services/lighthouse";
//
//   await withCronRun("weekly:lighthouse-audit", async () => {
//     for (const biz of businesses) {
//       const audit = await lighthouseFullAudit({
//         url: biz.website,
//         nap: { name: biz.name, address: biz.address, phone: biz.phone },
//       });
//       await prisma.lighthouseAudit.create({
//         data: toPersistRow(audit, biz.id),
//       });
//     }
//   });
//
// No live API in user request path · cost-counted · 24h KV-deduped.

export {
  // Composer + cache layers
  lighthouseFullAudit,
  lighthouseFullAuditUncached,
  lighthouseDomFetchUncached,
  // Schemas + types
  LighthouseFullAuditInputSchema,
  type LighthouseFullAuditInput,
  type LighthouseFullAuditResult,
  // Errors
  LighthouseHtmlFetchError,
  // Persistence helper
  toPersistRow,
  type LighthouseAuditPersistRow,
  // Test seams
  __setFetchForTesting,
  __setSleepForTesting,
} from "./audit";

export {
  // Public DOM-check entry points
  runDomChecks,
  hasLocalBusinessSchema,
  hasFaqSchema,
  hasPhoneAboveFold,
  hasBookingCtaAboveFold,
  napConsistent,
  // Helpers (exported for tests + downstream signal-engineer reuse)
  aboveFoldSlice,
  stripTags,
  extractJsonLdBlocks,
  collectJsonLdTypes,
  extractPhoneNumbers,
  normalizePhone,
  normalizeText,
  ABOVE_FOLD_BYTES,
  LOCAL_BUSINESS_TYPES,
  BOOKING_CTA_VERBS,
  type DomChecksInput,
  type DomChecksResult,
  type NapInput,
} from "./dom-checks";

export {
  LIGHTHOUSE_UNIT_COST_USD,
  type LighthouseOperation,
} from "./pricing";
