/**
 * SMB ads · public component surface. Import from here, not internal files.
 *
 * The page renders a hard VISUAL SPLIT between two stories:
 *   • GOOGLE — KeywordCostTable (sortable) + GoogleStartCard ("where to start")
 *     + GoogleAdvertiserLeaderboard
 *   • META   — MetaAdvertiserTable + MetaMarketAnalysis (format/service/promos/
 *     platform folded into one analysis block)
 * AdSuggestions is shared by both blocks (resolved per-network by the page).
 */

export { AdSuggestions } from "./AdSuggestions";
export type { AdSuggestionItem, AdSuggestionTone } from "./AdSuggestions";

export { KeywordCostTable } from "./KeywordCostTable";
export type { KeywordCostTableLabels } from "./KeywordCostTable";

export { GoogleStartCard } from "./GoogleStartCard";
export type { GoogleStartCardLabels, GoogleStartPick } from "./GoogleStartCard";

export { GoogleAdvertiserLeaderboard } from "./GoogleAdvertiserLeaderboard";
export type { GoogleAdvertiserLeaderboardLabels } from "./GoogleAdvertiserLeaderboard";

export { MetaAdvertiserTable } from "./MetaAdvertiserTable";
export type {
  MetaAdvertiserTableLabels,
  MetaAdvertiserRowView,
} from "./MetaAdvertiserTable";

export { MetaMarketAnalysis } from "./MetaMarketAnalysis";
export type {
  MetaMarketAnalysisLabels,
  FormatMixView,
  ServiceMixView,
  PromoView,
  PlatformStatView,
} from "./MetaMarketAnalysis";

export { PlatformIcons } from "./PlatformIcons";
