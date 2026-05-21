/**
 * Agency list-analytics module · barrel export (F.5).
 *
 * Consumers should import from this barrel rather than reaching into
 * submodules — keeps the surface stable as we evolve the internals.
 */

export { getListAnalyticsForAgency } from "./queries";

export {
  EMPTY_LIST_ANALYTICS,
  type ListAnalyticsData,
  type ListAnalyticsStats,
  type ListFunnelRow,
  type SignalCorrelation,
  type LeadStatusValue,
} from "./types";

export * from "./components";
