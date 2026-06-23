/**
 * Signal registry · D.1
 *
 * Canonical definition for every signal in the Mapsly platform. The Hunter
 * UI's filter picker, the Prospect detail view's evidence blocks, the cron
 * handlers, and the Mapsly Score formula all read from this single source.
 *
 * **Adding a new signal: read `.claude/rules/signal-engineering.md` first.**
 *
 * Conventions:
 *   - `key` is snake_case · stable across versions · used in wire format
 *   - `column` follows `ModelName.fieldName` from `prisma/schema.prisma`
 *   - `helpTooltip` is plain English (no jargon for Maria; jargon OK for Tom)
 *   - `defaultValue` is a "useful threshold" agencies start tuning from
 *   - Costs are in USD per business per refresh cycle (best estimate)
 */

import {
  BOOLEAN_COMPARATORS,
  ENUM_COMPARATORS,
  NUMERIC_COMPARATORS,
  STRING_COMPARATORS,
} from "./comparators";
import type { SignalCategory, SignalDefinition } from "./types";
import { agencySignals } from "./agency-signals";

// ─────────────────────────────────────────────────────────────────────────────
// 1. PROFILE COMPLETENESS — Google Business Profile fields
//    Cadence: weekly (refreshed in `business-profile-refresh` cron)
//    Cost: ~$0.0006 per business (DataForSEO Maps Standard)
// ─────────────────────────────────────────────────────────────────────────────

const profileSignals: readonly SignalDefinition[] = [
  {
    key: "has_phone",
    label: "Has phone number",
    helpTooltip:
      "Whether the Google Business Profile lists a phone. Missing phone is a high-impact fix — patients can't call.",
    category: "profile",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: false,
    source: "dataforseo:maps",
    cadence: "weekly",
    column: "Business.phone",
  },
  {
    key: "has_website",
    label: "Has website",
    helpTooltip:
      "Whether the Google Business Profile links to a website. ~12% of local SMBs have no website at all.",
    category: "profile",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: false,
    source: "dataforseo:maps",
    cadence: "weekly",
    column: "Business.website",
  },
  {
    key: "has_email",
    label: "Has verified email",
    helpTooltip:
      "Owner email captured and SMTP-verified by our email-verify service. Required for outbound contact.",
    category: "profile",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "internal",
    cadence: "monthly",
    column: "Business.emailVerifiedAt",
  },
  {
    key: "photo_count",
    label: "Photos on profile",
    helpTooltip:
      "Total photos on the GBP. Industry benchmark is 30+; below 10 signals neglect.",
    category: "profile",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "photos",
    defaultValue: 10,
    source: "dataforseo:maps",
    cadence: "weekly",
    column: "Business.photosCount",
  },
  {
    key: "hours_per_week",
    label: "Open hours per week",
    helpTooltip:
      "Sum of advertised open hours across the week. 60+ for retail · 40+ for services typical.",
    category: "profile",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "hours",
    defaultValue: 40,
    source: "dataforseo:maps",
    cadence: "weekly",
    column: "BusinessSnapshot.hoursPerWeek",
  },
  {
    key: "is_claimed",
    label: "Profile claimed",
    helpTooltip:
      "Whether the owner has claimed the Google Business Profile. Unclaimed = no replies, no updates.",
    category: "profile",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: false,
    source: "dataforseo:maps",
    cadence: "weekly",
    column: "Business.isClaimed",
  },
  {
    key: "years_on_google",
    label: "Years on Google",
    helpTooltip:
      "How long this business has had a Google profile. Proxy for tenure / stability.",
    category: "profile",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "years",
    defaultValue: 2,
    source: "dataforseo:maps",
    cadence: "weekly",
    column: "Business.yearsOnGoogle",
  },
  {
    key: "has_instagram",
    label: "Has Instagram handle",
    helpTooltip:
      "Profile links to an Instagram account. Indicates social-media maturity.",
    category: "profile",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "dataforseo:maps",
    cadence: "weekly",
    column: "Business.instagramHandle",
  },
  {
    key: "instagram_followers",
    label: "Instagram followers",
    helpTooltip:
      "Follower count on the linked Instagram. Useful proxy for brand presence.",
    category: "profile",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "followers",
    defaultValue: 500,
    source: "dataforseo:maps",
    cadence: "weekly",
    column: "Business.instagramFollowers",
  },
  {
    key: "category_count",
    label: "Number of GBP categories",
    helpTooltip:
      "How many categories the profile claims. 1 = under-optimized; 3+ = well-tuned.",
    category: "profile",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "categories",
    defaultValue: 1,
    source: "dataforseo:maps",
    cadence: "weekly",
    column: "Business.categories",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. REVIEWS & REPUTATION
//    Cadence: weekly full pull · daily delta for new reviews
//    Cost: ~$0.002 per business (DataForSEO Reviews API)
// ─────────────────────────────────────────────────────────────────────────────

const reviewSignals: readonly SignalDefinition[] = [
  {
    key: "rating",
    label: "Google rating",
    helpTooltip:
      "Current star rating from Google. 4.4 is the industry median across local SMBs.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "stars",
    defaultValue: 4.0,
    source: "dataforseo:reviews",
    cadence: "weekly",
    column: "Business.rating",
  },
  {
    key: "review_count",
    label: "Total review count",
    helpTooltip:
      "Total Google reviews. Proxy for active operations: ≥100 means the business is open and getting customers.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "reviews",
    defaultValue: 100,
    source: "dataforseo:reviews",
    cadence: "weekly",
    column: "Business.reviewCount",
  },
  {
    key: "reply_rate",
    label: "Owner reply rate (last 20 reviews)",
    helpTooltip:
      "% of last 20 reviews with an owner response. Industry benchmark ~89%. Filter < 25 for ripe outreach.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "%",
    defaultValue: 25,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "BusinessSnapshot.replyRate",
  },
  {
    key: "unanswered_count",
    label: "Unanswered reviews",
    helpTooltip:
      "Reviews where the owner has not responded. Strong pitch signal — agency can drive impact in week 1.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "reviews",
    defaultValue: 5,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "Review.ownerReplied",
  },
  {
    key: "unanswered_1star_count",
    label: "Unanswered 1★ reviews",
    helpTooltip:
      "1★ reviews without an owner response. Highest-impact fix — most damaging to conversion.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "reviews",
    defaultValue: 1,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "Review.stars",
  },
  {
    key: "unanswered_aged_1star",
    label: "Aged unanswered 1★ (>7 days)",
    helpTooltip:
      "1★ reviews older than 7 days with no response. Triggers `Review.isUrgent` flag.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "reviews",
    defaultValue: 1,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "Review.isUrgent",
  },
  {
    key: "velocity_30d",
    label: "Review velocity (last 30 days)",
    helpTooltip:
      "New reviews in the trailing 30 days. Steady velocity (≥4/mo) signals healthy operations.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "reviews",
    defaultValue: 4,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "BusinessSnapshot.velocityLast30d",
  },
  {
    key: "last_review_age_days",
    label: "Days since last review",
    helpTooltip:
      "Recency of the most recent review. >60 days = stale; >180 days = likely declining.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "days",
    defaultValue: 60,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "Review.postedAt",
  },
  {
    key: "rating_1star_pct",
    label: "Share of 1★ reviews",
    helpTooltip:
      "% of total reviews that are 1★. Benchmark <5%; ≥10% indicates a real reputation problem.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "%",
    defaultValue: 10,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "BusinessSnapshot.raw",
  },
  {
    key: "rating_5star_pct",
    label: "Share of 5★ reviews",
    helpTooltip:
      "% of total reviews that are 5★. Median ~72%; <60% means rating drag.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "%",
    defaultValue: 60,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "BusinessSnapshot.raw",
  },
  {
    key: "avg_sentiment",
    label: "Average review sentiment",
    helpTooltip:
      "AI-classified sentiment of recent reviews (-1 to +1). Useful when star-rating alone hides nuance.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    defaultValue: 0,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "Review.sentiment",
  },
  {
    key: "has_negative_theme",
    label: "Negative theme present",
    helpTooltip:
      "AI-extracted theme cluster contains a negative pattern (e.g. 'rude staff', 'overcharged', 'long wait').",
    category: "reviews",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "Review.themes",
  },
  {
    key: "bilingual_reviews_pct",
    label: "% bilingual reviews",
    helpTooltip:
      "Share of reviews not in the dominant business language. Hints at multi-language reply opportunity.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "%",
    defaultValue: 15,
    source: "computed-from-reviews",
    cadence: "weekly",
    column: "Review.language",
  },
  {
    key: "review_velocity_vs_leader",
    label: "Review velocity vs local leader",
    helpTooltip:
      "% of the top-rated competitor's 30d velocity. <50% = falling behind.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "%",
    defaultValue: 50,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.raw",
  },
  {
    key: "reputation_subscore",
    label: "Reputation sub-score",
    helpTooltip:
      "0–10 composite of rating + review count + recency. One of 6 Mapsly Score dimensions.",
    category: "reviews",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    defaultValue: 5,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.reputationScore",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. WEBSITE & TECH — Lighthouse + DOM checks
//    Cadence: weekly · 24h dedup cache · cost ~$0.001/audit
// ─────────────────────────────────────────────────────────────────────────────

const websiteSignals: readonly SignalDefinition[] = [
  {
    key: "lighthouse_performance",
    label: "Lighthouse Performance (mobile)",
    helpTooltip:
      "Google Lighthouse mobile performance score. 90+ healthy; <50 actively hurts conversion + SEO.",
    category: "website",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "/100",
    defaultValue: 50,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.performance",
  },
  {
    key: "lighthouse_seo",
    label: "Lighthouse SEO",
    helpTooltip:
      "Lighthouse SEO score. 95+ standard; covers meta tags, crawlability, mobile-friendliness.",
    category: "website",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "/100",
    defaultValue: 90,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.seo",
  },
  {
    key: "lighthouse_a11y",
    label: "Lighthouse Accessibility",
    helpTooltip:
      "Accessibility score. <80 indicates real usability problems; medico-legal risk in some verticals.",
    category: "website",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "/100",
    defaultValue: 80,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.accessibility",
  },
  {
    key: "lighthouse_best_practices",
    label: "Lighthouse Best Practices",
    helpTooltip:
      "Code quality + security + console errors. <80 = tech debt visible to users.",
    category: "website",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "/100",
    defaultValue: 80,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.bestPractices",
  },
  {
    key: "lcp_seconds",
    label: "LCP (Largest Contentful Paint)",
    helpTooltip:
      "Time to render main content in seconds. ≤2.5s good · 2.5–4s needs work · >4s poor.",
    category: "website",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "s",
    defaultValue: 2.5,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.lcp",
  },
  {
    key: "cls",
    label: "CLS (Cumulative Layout Shift)",
    helpTooltip:
      "Visual stability score. ≤0.1 good · ≤0.25 needs work · >0.25 poor. Layout-thrash hurts mobile UX.",
    category: "website",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    defaultValue: 0.1,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.cls",
  },
  {
    key: "inp_ms",
    label: "INP (Interaction to Next Paint)",
    helpTooltip:
      "Responsiveness. ≤200ms good · 200–500ms needs work · >500ms poor. Replaced FID in CWV.",
    category: "website",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "ms",
    defaultValue: 200,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.inp",
  },
  {
    key: "fcp_seconds",
    label: "FCP (First Contentful Paint)",
    helpTooltip:
      "Time to first visible content. ≤1.8s good. Supplements LCP for slow first-paint diagnoses.",
    category: "website",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "s",
    defaultValue: 1.8,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.fcp",
  },
  {
    key: "has_localbusiness_schema",
    label: "Has LocalBusiness schema",
    helpTooltip:
      "JSON-LD schema.org/LocalBusiness markup detected. Required for rich snippets in local search.",
    category: "website",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: false,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.hasLocalBusinessSchema",
  },
  {
    key: "has_faq_schema",
    label: "Has FAQ schema",
    helpTooltip:
      "FAQPage JSON-LD detected. Eligible for FAQ rich snippet; common quick win.",
    category: "website",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: false,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.hasFaqSchema",
  },
  {
    key: "has_booking_cta_above_fold",
    label: "Booking CTA above the fold",
    helpTooltip:
      "Above-the-fold call-to-action that triggers a booking flow. Missing = leaking conversions.",
    category: "website",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: false,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.hasBookingCtaAboveFold",
  },
  {
    key: "has_phone_above_fold",
    label: "Phone above the fold",
    helpTooltip:
      "Click-to-call phone link visible without scrolling. Critical on mobile.",
    category: "website",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: false,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.hasPhoneAboveFold",
  },
  {
    key: "nap_consistent",
    label: "NAP consistent",
    helpTooltip:
      "Name, Address, Phone on the website match the Google profile. Inconsistency hurts local SEO.",
    category: "website",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.napConsistent",
  },
  {
    key: "tech_stack_includes",
    label: "Tech stack includes",
    helpTooltip:
      "Wappalyzer-detected tech (e.g. 'WordPress', 'Squarespace', 'Wix'). Useful for platform-specific pitches.",
    category: "website",
    type: "enum",
    comparators: ENUM_COMPARATORS,
    enumValues: [
      "wordpress",
      "squarespace",
      "wix",
      "shopify",
      "webflow",
      "duda",
      "godaddy",
      "custom",
    ],
    defaultValue: "wordpress",
    source: "dataforseo:lighthouse",
    cadence: "weekly",
    column: "LighthouseAudit.techStack",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4. SEARCH & LOCAL SEO — SERP rank + share of voice
//    Cadence: weekly · cost ~$0.001/keyword/scan (Standard queue)
// ─────────────────────────────────────────────────────────────────────────────

const searchSignals: readonly SignalDefinition[] = [
  {
    key: "local_pack_rank",
    label: "Local pack rank (best keyword)",
    helpTooltip:
      "Best position in the 3-pack across the business's target keyword set. 1–3 = appears in pack.",
    category: "search",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    defaultValue: 3,
    source: "dataforseo:serp",
    cadence: "weekly",
    column: "SerpResult.localPackRank",
  },
  {
    key: "in_local_pack",
    label: "In local 3-pack for any keyword",
    helpTooltip:
      "True if the business appears in the Maps 3-pack for at least one target keyword.",
    category: "search",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: false,
    source: "dataforseo:serp",
    cadence: "weekly",
    column: "SerpResult.localPackRank",
  },
  {
    key: "organic_rank_best",
    label: "Best organic rank (any keyword)",
    helpTooltip:
      "Best organic position across the keyword set. <=10 = page 1; ranking >50 means invisible.",
    category: "search",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    defaultValue: 10,
    source: "dataforseo:serp",
    cadence: "weekly",
    column: "SerpResult.organicRank",
  },
  {
    key: "keyword_count_ranked",
    label: "Keywords ranked (top 10)",
    helpTooltip:
      "How many target keywords this business appears for in the top 10 organic results.",
    category: "search",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "keywords",
    defaultValue: 3,
    source: "dataforseo:serp",
    cadence: "weekly",
    column: "SerpResult.organicRank",
  },
  {
    key: "share_of_voice",
    label: "Share of voice (local pack)",
    helpTooltip:
      "% of target keywords where the business appears in the local pack. 33% = average; 60%+ = market leader.",
    category: "search",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "%",
    defaultValue: 33,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.raw",
  },
  {
    key: "rank_drop_last_30d",
    label: "Rank drop (last 30 days)",
    helpTooltip:
      "Positions lost on the best-ranking keyword over the last 30 days. ≥3 = active SEO regression.",
    category: "search",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "positions",
    defaultValue: 3,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "SerpResult.organicRank",
  },
  {
    key: "branded_organic_rank",
    label: "Organic rank for branded query",
    helpTooltip:
      "Organic position when someone Googles the business name. Should always be 1; if not, brand-SEO problem.",
    category: "search",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    defaultValue: 1,
    source: "dataforseo:serp",
    cadence: "weekly",
    column: "SerpResult.organicRank",
  },
  {
    key: "ranks_for_competitor_name",
    label: "Ranks for competitor's brand query",
    helpTooltip:
      "True if this business appears when a competitor's name is searched (= aggressive comparison play).",
    category: "search",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "dataforseo:serp",
    cadence: "weekly",
    column: "SerpResult.isBrandQuery",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 5. ADS & PAID — Meta Ad Library + Google Ads Transparency
//    Cadence: daily delta · cost ~$0 (free Meta Library) + ~$0.0005 Google Trans.
// ─────────────────────────────────────────────────────────────────────────────

const adsSignals: readonly SignalDefinition[] = [
  {
    key: "has_active_meta_ads",
    label: "Running Meta ads",
    helpTooltip:
      "At least one active ad in the Meta Ad Library (Facebook + Instagram). Indicates paid acquisition is in play.",
    category: "ads",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "meta-ad-library",
    cadence: "daily",
    column: "AdLibraryEntry.isActive",
  },
  {
    key: "meta_ad_count",
    label: "Active Meta ad count",
    helpTooltip:
      "Number of distinct active Meta ad creatives. ≥5 = serious paid program.",
    category: "ads",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "ads",
    defaultValue: 1,
    source: "meta-ad-library",
    cadence: "daily",
    column: "AdLibraryEntry.id",
  },
  {
    key: "has_active_google_ads",
    label: "Running Google ads",
    helpTooltip:
      "At least one active Google Search/Display ad found in Google Ads Transparency Center.",
    category: "ads",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "google-ads-transparency",
    cadence: "daily",
    column: "AdLibraryEntry.isActive",
  },
  {
    key: "ads_age_days",
    label: "Newest ad age",
    helpTooltip:
      "Days since the newest active ad started. <14 = recently active campaign; >180 = stale creative.",
    category: "ads",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "days",
    defaultValue: 30,
    source: "meta-ad-library",
    cadence: "daily",
    column: "AdLibraryEntry.startedAt",
  },
  {
    key: "brand_hijack_detected",
    label: "Brand-hijack detected",
    helpTooltip:
      "A competitor is bidding on this business's brand-name search query. High-urgency outreach trigger.",
    category: "ads",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "dataforseo:serp",
    cadence: "daily",
    column: "SerpResult.paidBidders",
  },
  {
    key: "estimated_monthly_ad_spend",
    label: "Estimated monthly ad spend",
    helpTooltip:
      "Midpoint estimate from Meta Ad Library impression bands + Google Transparency. Loose — ±50%.",
    category: "ads",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "$",
    defaultValue: 500,
    source: "computed-from-snapshots",
    cadence: "daily",
    column: "AdLibraryEntry.spendMidHigh",
  },
  {
    key: "ad_landing_pages_count",
    label: "Distinct ad landing pages",
    helpTooltip:
      "Unique landing URLs across active ads. 1 = single funnel; 5+ = segmented campaigns.",
    category: "ads",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "pages",
    defaultValue: 1,
    source: "meta-ad-library",
    cadence: "daily",
    column: "AdLibraryEntry.landingUrl",
  },
  {
    key: "ad_theme_includes",
    label: "Ad theme includes",
    helpTooltip:
      "Free-text search across active ad creative bodies (e.g. 'free consultation', 'first visit').",
    category: "ads",
    type: "string",
    comparators: STRING_COMPARATORS,
    defaultValue: "",
    source: "meta-ad-library",
    cadence: "daily",
    column: "AdLibraryEntry.adCreativeBody",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 6. COMPETITIVE & GEO — Market position + proximity
//    Cadence: weekly aggregate · cost: 0 (computed from existing snapshots)
// ─────────────────────────────────────────────────────────────────────────────

const competitiveSignals: readonly SignalDefinition[] = [
  {
    key: "msi_rank",
    label: "MSI rank (market position)",
    helpTooltip:
      "Mapsly Share Index rank — where the business stands among all competitors in its metro + category.",
    category: "competitive",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    defaultValue: 10,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.msiRank",
  },
  {
    key: "msi_percentile",
    label: "MSI percentile",
    helpTooltip:
      "Inverse percentile — 90 means top 10%. Useful for 'mid-market' filters across metros of different sizes.",
    category: "competitive",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "%",
    defaultValue: 50,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.raw",
  },
  {
    key: "new_competitors_90d",
    label: "New competitors in metro (90d)",
    helpTooltip:
      "Competitors that entered the same metro + category in the last 90 days. Pressure signal.",
    category: "competitive",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "competitors",
    defaultValue: 3,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "Business.firstSeenOnGoogle",
  },
  {
    key: "same_building_competitors",
    label: "Same-building competitor count",
    helpTooltip:
      "Competitors within 50m. ≥1 = direct geographic conflict; useful for category-share pitches.",
    category: "competitive",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "competitors",
    defaultValue: 1,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.raw",
  },
  {
    key: "rating_gap_to_leader",
    label: "Rating gap to market leader",
    helpTooltip:
      "Difference between market leader's rating and this business's. >0.4 = visible competitive disadvantage.",
    category: "competitive",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "stars",
    defaultValue: 0.4,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.raw",
  },
  {
    key: "review_count_gap_to_leader",
    label: "Review-count gap to leader",
    helpTooltip:
      "How many reviews behind the local-pack leader. ≥200 = serious volume gap.",
    category: "competitive",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "reviews",
    defaultValue: 200,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.raw",
  },
  {
    key: "competitor_passed_us_in_reviews",
    label: "Competitor recently passed us in reviews",
    helpTooltip:
      "A direct competitor crossed our review count in the last 30 days. Time-sensitive outreach trigger.",
    category: "competitive",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.raw",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 7. BUSINESS QUALIFIERS — Category, geo, score
//    Cadence: static (category, city) or weekly (Mapsly Score)
// ─────────────────────────────────────────────────────────────────────────────

const qualifierSignals: readonly SignalDefinition[] = [
  {
    key: "category",
    label: "Primary category",
    helpTooltip:
      "Google's primary category for the business (e.g. 'medical_spa', 'auto_body_shop').",
    category: "qualifiers",
    type: "string",
    comparators: STRING_COMPARATORS,
    defaultValue: "",
    source: "dataforseo:maps",
    cadence: "static",
    column: "Business.category",
  },
  {
    key: "city",
    label: "City",
    helpTooltip: "Geographic city. Use for metro-targeting filters.",
    category: "qualifiers",
    type: "string",
    comparators: STRING_COMPARATORS,
    defaultValue: "",
    source: "dataforseo:maps",
    cadence: "static",
    column: "Business.city",
  },
  {
    key: "province",
    label: "State / Province",
    helpTooltip:
      "US state / Canadian province (ISO 2-letter). For regulated industries (cannabis, healthcare).",
    category: "qualifiers",
    type: "string",
    comparators: STRING_COMPARATORS,
    defaultValue: "",
    source: "dataforseo:maps",
    cadence: "static",
    column: "Business.province",
  },
  {
    key: "country",
    label: "Country",
    helpTooltip: "Country (ISO 2-letter). US or CA in v1.",
    category: "qualifiers",
    type: "enum",
    comparators: ENUM_COMPARATORS,
    enumValues: ["US", "CA"],
    defaultValue: "US",
    source: "dataforseo:maps",
    cadence: "static",
    column: "Business.country",
  },
  {
    key: "mapsly_score",
    label: "Mapsly Score (0–10)",
    helpTooltip:
      "Weighted composite across 6 dimensions. <5 = real problems; 5–7 = average; 8+ = healthy.",
    category: "qualifiers",
    type: "numeric",
    comparators: NUMERIC_COMPARATORS,
    valueUnit: "/10",
    defaultValue: 5,
    source: "computed-from-snapshots",
    cadence: "weekly",
    column: "BusinessSnapshot.mapslyScore",
  },
  {
    key: "is_active",
    label: "Active business",
    helpTooltip:
      "Not marked closed or hidden in our index. Used to skip dead profiles.",
    category: "qualifiers",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "internal",
    cadence: "weekly",
    column: "Business.isActive",
  },
  {
    key: "is_owner_claimed_in_mapsly",
    label: "Owned by a Mapsly SMB user",
    helpTooltip:
      "True if this business has been claimed inside Mapsly by its SMB owner. Useful to exclude existing users.",
    category: "qualifiers",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: false,
    source: "internal",
    cadence: "static",
    column: "Business.ownerUserId",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 8. EXCLUSIONS — Skip filters (inverted semantics on the Hunter wire)
//    Cadence: real-time (internal state) · cost 0
// ─────────────────────────────────────────────────────────────────────────────

const exclusionSignals: readonly SignalDefinition[] = [
  {
    key: "exclude_already_on_list",
    label: "Already on one of my lists",
    helpTooltip:
      "Skip businesses that are already on any of this agency's lists. Prevents pipeline duplication.",
    category: "exclusions",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "internal",
    cadence: "static",
    column: "Lead.id",
    isExclusion: true,
  },
  {
    key: "exclude_already_contacted",
    label: "Already contacted",
    helpTooltip:
      "Skip leads with a recorded `contactedAt` timestamp. Avoids re-pitching active prospects.",
    category: "exclusions",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "internal",
    cadence: "static",
    column: "Lead.contactedAt",
    isExclusion: true,
  },
  {
    key: "exclude_existing_client",
    label: "Already a client",
    helpTooltip:
      "Skip businesses marked as existing agency clients (Lead.status = WON).",
    category: "exclusions",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "internal",
    cadence: "static",
    column: "Lead.status",
    isExclusion: true,
  },
  {
    key: "exclude_lost",
    label: "Recently marked LOST",
    helpTooltip:
      "Skip leads previously marked LOST (declined or unfit). Avoids re-pitching dead prospects.",
    category: "exclusions",
    type: "boolean",
    comparators: BOOLEAN_COMPARATORS,
    defaultValue: true,
    source: "internal",
    cadence: "static",
    column: "Lead.status",
    isExclusion: true,
  },
  {
    key: "exclude_categories",
    label: "Exclude categories",
    helpTooltip:
      "Skip businesses in the listed categories. Use to remove franchises, chains, or non-fit verticals.",
    category: "exclusions",
    type: "enum",
    comparators: ENUM_COMPARATORS,
    defaultValue: "",
    source: "internal",
    cadence: "static",
    column: "Business.category",
    isExclusion: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY · single source of truth
// ─────────────────────────────────────────────────────────────────────────────

const allSignals: readonly SignalDefinition[] = [
  ...profileSignals,
  ...reviewSignals,
  ...websiteSignals,
  ...searchSignals,
  ...adsSignals,
  ...competitiveSignals,
  ...qualifierSignals,
  ...exclusionSignals,
  ...agencySignals, // demand-driven rework: reachability, tech, comparative reviews, expert/compliance, freshness
];

/**
 * Canonical map: signal key → definition.
 * **Read-only**. Adding signals requires editing the per-category arrays above.
 */
export const SIGNALS: Readonly<Record<string, SignalDefinition>> =
  Object.freeze(Object.fromEntries(allSignals.map((s) => [s.key, s])));

/** All signals in registration order. */
export const SIGNALS_ORDERED: readonly SignalDefinition[] = Object.freeze([
  ...allSignals,
]);

/** Lookup a signal definition by key. Returns `undefined` if unknown. */
export function getSignal(key: string): SignalDefinition | undefined {
  return SIGNALS[key];
}

/** All signals for a given category, in registration order. */
export function getSignalsByCategory(
  category: SignalCategory,
): readonly SignalDefinition[] {
  return SIGNALS_ORDERED.filter((s) => s.category === category);
}

/** Count of registered signals (kept stable as a tripwire for the rule contract). */
export const SIGNAL_COUNT = SIGNALS_ORDERED.length;
