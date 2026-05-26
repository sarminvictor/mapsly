/**
 * SMB "How you compare" · module barrel.
 *
 * Server-only — client components should not import from here.
 */

export { getSmbHowYouCompareData } from "./queries";
export {
  EMPTY_SMB_HOW_YOU_COMPARE,
  EMPTY_MARKET_MEDIANS,
  MARKET_SLICE_CAP,
  MARKET_TOP_N,
  MARKET_MOVERS_N,
  MAX_THREATS,
  MAX_COMPETITORS,
  deriveHeadToHead,
  deriveMedians,
  deriveThreats,
  addressKey,
  type CompetitorRow,
  type HeadToHeadDimension,
  type SmbCompetitorThreat,
  type MarketRankingRow,
  type MarketMedians,
  type MarketMover,
  type SmbHowYouCompareData,
} from "./types";
