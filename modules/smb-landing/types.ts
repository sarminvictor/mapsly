/**
 * Public landing-page payload types (`/l/[slug]-[token]`).
 *
 * Everything here is the business's REAL latest-snapshot data, assembled by
 * `getLandingData(businessId)`. Each section carries a `hasData` flag so the
 * page can honestly say "we don't track this for you yet" instead of faking a
 * number — and those gaps double as the reason to subscribe.
 *
 * Shapes mirror the design (the emailed proposal): a hero score panel, a
 * "what changed this week" summary, per-section blocks (search / ads / reviews
 * / website) each with a market-relative "problem → solution" callout, a
 * ranked fixes block, and the $29 pricing band.
 *
 * `EMPTY_LANDING_DATA` is the build-phase / error shape per
 * `.claude/rules/cache-components.md` Pattern 1. A genuine "token not found" is
 * handled with `notFound()`, not EMPTY.
 */

import type { SmbOverviewFix } from "@/modules/smb-home/types";

/** One "what changed this week" insight card. */
export interface LandingChange {
  id: string;
  /** Card title ("Your ranking is slipping"). */
  title: string;
  /** Right-aligned meta ("47 days out" / "this month" / "out of sync"). */
  meta: string;
  /** Big stat value ("4" / "23" / "+40"). */
  value: string;
  /** Secondary text after the value ("→ 2 risk" / "people" / "%"). */
  valueSuffix: string;
  /** Rating stars on the right of the stat row (card 1), else null. */
  stars: number | null;
  /** Progress-bar fill 0–100. */
  barPct: number;
  barColor: "gold" | "coral" | "green";
  /** One-line description under the bar. */
  desc: string;
  /** Faded "preview / unlock with Pro" card. */
  faded: boolean;
}

/** Search / visibility detail ("Where you show up on Google"). */
export interface LandingSearchData {
  hasData: boolean;
  /** Best (lowest) organic OR maps rank across tracked keywords. */
  bestRank: number | null;
  keywordsTracked: number;
  /** Monthly searches you actually capture (~30) vs total available (~3,020). */
  searchesYouGet: number | null;
  searchesTotal: number | null;
  /** Top keywords by volume — the table rows. */
  topKeywords: {
    keyword: string;
    volume: number | null;
    organicRank: number | null;
    mapsRank: number | null;
    estCustomers: number | null;
  }[];
  pillar: number | null;
}

/** Ads detail ("competitors pay to be the answer"). */
export interface LandingAdsData {
  hasData: boolean;
  ownAdCount: number;
  /** Advertisers running in your market cell. */
  marketAdvertiserCount: number;
  /** Total active ads across those advertisers. */
  marketActiveAds: number;
  competitors: {
    name: string;
    platforms: string[];
    activeAds: number;
    isOwn: boolean;
  }[];
  pillar: number | null;
  adsApplicable: boolean | null;
}

/** Reviews / reputation detail ("what patients praise"). */
export interface LandingReviewsData {
  hasData: boolean;
  rating: number | null;
  reviewCount: number | null;
  /** 0–1 owner reply rate. */
  replyRate: number | null;
  unanswered: number;
  /** New reviews in the last 30 days ("+53 this month"). */
  trend30d: number;
  /** Your position by review count in the cell ("#26"). */
  yourRank: number | null;
  rankedTotal: number | null;
  /** Review themes (Google's extracted place topics). */
  themes: { label: string; count: number }[];
  /** Competitor comparison — top peers in the cell + you. */
  competitors: {
    name: string;
    rating: number | null;
    reviewCount: number | null;
    trend30d: number | null;
    responseRate: number | null;
    rank: number;
    isOwn: boolean;
  }[];
  pillar: number | null;
}

/** One website audit check (the "12 things patients notice" checklist). */
export interface LandingWebsiteCheck {
  key: string;
  label: string;
  /** true = pass · false = fail · null = couldn't measure. */
  pass: boolean | null;
  /** Per-check evidence line ("Your LCP: 4.7s · median: under 2.5s"). */
  detail: string | null;
}

/** Website detail ("graded on 12 things"). */
export interface LandingWebsiteData {
  hasData: boolean;
  websiteUrl: string | null;
  performance: number | null; // 0–100 your score
  seo: number | null;
  /** Market reference (top-10 cohort) — median + best. */
  industryMedian: number | null;
  industryBest: number | null;
  checks: LandingWebsiteCheck[];
  passCount: number;
  totalChecks: number;
  pillar: number | null;
}

/** A market-relative "problem → solution" callout (real, computed). */
export interface LandingGap {
  problem: string;
  solution: string;
}

/** The full landing payload. */
export interface LandingData {
  // Identity + hero
  businessId: string;
  name: string;
  slug: string;
  token: string;
  category: string;
  address: string | null;
  city: string | null;
  province: string | null;
  cellLabel: string | null;

  // Hero metrics
  mapslyScore: number | null; // 0–10 pillarScore
  rank: number | null;
  total: number | null;
  rankDelta: number | null;
  googleRating: number | null;
  reviewCount: number | null;

  // Pillars (section scores)
  reputation: number | null;
  visibility: number | null;
  ads: number | null;
  website: number | null;
  profile: number | null;
  adsApplicable: boolean | null;

  // "What changed in your area this week" (summary rows)
  changes: LandingChange[];

  // Section detail
  search: LandingSearchData;
  adsDetail: LandingAdsData;
  reviews: LandingReviewsData;
  websiteDetail: LandingWebsiteData;

  // "Where you stand. What to fix."
  fixes: SmbOverviewFix[];

  // Shared market-gap callout (you-capture vs market)
  gap: LandingGap | null;

  // Meta
  lastSnapshotAt: Date | null;
  hasAnyData: boolean;
}

export const EMPTY_LANDING_SEARCH: LandingSearchData = {
  hasData: false,
  bestRank: null,
  keywordsTracked: 0,
  searchesYouGet: null,
  searchesTotal: null,
  topKeywords: [],
  pillar: null,
};

export const EMPTY_LANDING_ADS: LandingAdsData = {
  hasData: false,
  ownAdCount: 0,
  marketAdvertiserCount: 0,
  marketActiveAds: 0,
  competitors: [],
  pillar: null,
  adsApplicable: null,
};

export const EMPTY_LANDING_REVIEWS: LandingReviewsData = {
  hasData: false,
  rating: null,
  reviewCount: null,
  replyRate: null,
  unanswered: 0,
  trend30d: 0,
  yourRank: null,
  rankedTotal: null,
  themes: [],
  competitors: [],
  pillar: null,
};

export const EMPTY_LANDING_WEBSITE: LandingWebsiteData = {
  hasData: false,
  websiteUrl: null,
  performance: null,
  seo: null,
  industryMedian: null,
  industryBest: null,
  checks: [],
  passCount: 0,
  totalChecks: 0,
  pillar: null,
};

export const EMPTY_LANDING_DATA: LandingData = {
  businessId: "",
  name: "",
  slug: "",
  token: "",
  category: "",
  address: null,
  city: null,
  province: null,
  cellLabel: null,
  mapslyScore: null,
  rank: null,
  total: null,
  rankDelta: null,
  googleRating: null,
  reviewCount: null,
  reputation: null,
  visibility: null,
  ads: null,
  website: null,
  profile: null,
  adsApplicable: null,
  changes: [],
  search: EMPTY_LANDING_SEARCH,
  adsDetail: EMPTY_LANDING_ADS,
  reviews: EMPTY_LANDING_REVIEWS,
  websiteDetail: EMPTY_LANDING_WEBSITE,
  fixes: [],
  gap: null,
  lastSnapshotAt: null,
  hasAnyData: false,
};

/** The 12 website checks we grade, in display order. Labels are plain-English
 * (Maria's voice) — the DOM/Lighthouse booleans map onto these keys. */
export const LANDING_WEBSITE_CHECK_LABELS: { key: string; label: string }[] = [
  { key: "loadsFast", label: "Loads in under 3 seconds" },
  { key: "smoothScroll", label: "Doesn't jump while loading" },
  { key: "quickToRespond", label: "Responds quickly to taps" },
  { key: "foundOnGoogle", label: "Easy for Google to read" },
  { key: "phoneAboveFold", label: "Phone number up top" },
  { key: "bookingAboveFold", label: "Booking button up top" },
  { key: "localBusinessSchema", label: "Tells Google your details" },
  { key: "faqSchema", label: "Answers common questions" },
  { key: "napConsistent", label: "Address matches Google" },
  { key: "worksWithoutJs", label: "Shows up without scripts" },
  { key: "secure", label: "Secure (https)" },
  { key: "hasWebsite", label: "Has a working website" },
];
