/**
 * SMB reviews · component barrel.
 *
 * Server-component-only library. Built on top of the shared
 * `components/ui` primitives (Pill) and `modules/smb-home`
 * conventions (cream + coral palette, warm voice).
 *
 * Do not use in Agency routes — these components carry SMB voice and
 * tone. The Agency portal has its own reviews surfaces (built later in
 * Phase F).
 */

export { StarRating, type StarRatingProps } from "./StarRating";
export {
  ReviewCard,
  type ReviewCardProps,
  type ReviewCardLabels,
} from "./ReviewCard";
export {
  ReviewTabs,
  type ReviewTabsProps,
  type ReviewTabsLabels,
} from "./ReviewTabs";
export {
  RatingDistributionCard,
  type RatingDistributionCardProps,
  type RatingDistributionCardLabels,
} from "./RatingDistributionCard";
export {
  ThemesCard,
  type ThemesCardProps,
  type ThemesCardLabels,
} from "./ThemesCard";
export {
  CompetitorBenchmarkCard,
  type CompetitorBenchmarkLabels,
} from "./CompetitorBenchmarkCard";
export { ReviewTrendCard, type ReviewTrendCardLabels } from "./ReviewTrendCard";
export {
  ServiceMentionsCard,
  type ServiceMentionsCardLabels,
} from "./ServiceMentionsCard";
export {
  MentionedNamesCard,
  type MentionedNamesCardLabels,
} from "./MentionedNamesCard";
export { HighlightedReviewText } from "./HighlightedReviewText";
export { PaginatedReviewList } from "./PaginatedReviewList";
export { PrivacyMarkedReplyText } from "./PrivacyMarkedReplyText";
export {
  PrivacySummaryCard,
  type PrivacySummaryCardLabels,
  type PrivacySummaryCardProps,
} from "./PrivacySummaryCard";
export { PrivacyWarnIcon } from "./PrivacyWarnIcon";
