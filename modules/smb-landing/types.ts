/**
 * Public landing-page payload types (`/l/[slug]-[token]`).
 *
 * Everything here is the business's REAL latest-snapshot data, assembled by
 * `getLandingData(businessId)`. Each section carries a `hasData` flag so the
 * page can honestly say "we don't track this for you yet" instead of faking a
 * number — and those gaps double as the reason to subscribe.
 *
 * `EMPTY_LANDING_DATA` is the build-phase / error shape per
 * `.claude/rules/cache-components.md` Pattern 1 (every field present so
 * TypeScript catches partial shapes at literal-comparison time on Vercel
 * build). A genuine "token not found" is handled with `notFound()`, not EMPTY.
 */

import type { SmbMarketChange, SmbOverviewFix } from "@/modules/smb-home/types";

/** Search / visibility detail (the "Where you show up on Google" block). */
export interface LandingSearchData {
  hasData: boolean;
  /** Best (lowest) organic OR maps rank across tracked keywords. */
  bestRank: number | null;
  keywordsTracked: number;
  /** Top keywords by traffic value — the table rows. */
  topKeywords: {
    keyword: string;
    volume: number | null;
    organicRank: number | null;
    mapsRank: number | null;
    estCustomers: number | null;
  }[];
  pillar: number | null;
}

/** Ads detail (the "competitors pay to be the answer" block). */
export interface LandingAdsData {
  hasData: boolean;
  ownAdCount: number;
  /** Advertisers in the same market cell — the competitor table. */
  competitors: {
    name: string;
    platforms: string[];
    activeAds: number;
    isOwn: boolean;
  }[];
  pillar: number | null;
  adsApplicable: boolean | null;
}

/** Reviews / reputation detail (the "what patients praise" block). */
export interface LandingReviewsData {
  hasData: boolean;
  rating: number | null;
  reviewCount: number | null;
  /** 0–1 owner reply rate. */
  replyRate: number | null;
  unanswered: number;
  /** Review themes (from Google's extracted place topics). */
  themes: { label: string; count: number }[];
  /** Small competitor comparison — top peers in the cell by review count. */
  competitors: {
    name: string;
    rating: number | null;
    reviewCount: number | null;
    isOwn: boolean;
  }[];
  pillar: number | null;
}

/** One website audit check (the "12 things patients notice" checklist). */
export interface LandingWebsiteCheck {
  key: string;
  label: string;
  /** true = pass · false = fail · null = we couldn't measure it. */
  pass: boolean | null;
}

/** Website detail (the "graded on 12 things" block). */
export interface LandingWebsiteData {
  hasData: boolean;
  websiteUrl: string | null;
  performance: number | null; // 0–100 (mobile Lighthouse)
  seo: number | null; // 0–100
  checks: LandingWebsiteCheck[];
  passCount: number;
  totalChecks: number;
  pillar: number | null;
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
  /** Human market label for the standing line ("Miami" / "Miami area"). */
  cellLabel: string | null;

  // Hero metrics (all real, null when not yet scored / collected)
  mapslyScore: number | null; // 0–10 pillarScore
  rank: number | null; // standing in the market cell
  total: number | null; // "of N"
  rankDelta: number | null; // weekly movement (warms up)
  googleRating: number | null;
  reviewCount: number | null;

  // Pillars (section scores)
  reputation: number | null;
  visibility: number | null;
  ads: number | null;
  website: number | null;
  profile: number | null;
  adsApplicable: boolean | null;

  // "What changed in your area this week"
  events: SmbMarketChange[];

  // Section detail
  search: LandingSearchData;
  adsDetail: LandingAdsData;
  reviews: LandingReviewsData;
  websiteDetail: LandingWebsiteData;

  // "Where you stand. What to fix."
  fixes: SmbOverviewFix[];

  // Meta
  lastSnapshotAt: Date | null;
  /** True when at least one section has real data to show. */
  hasAnyData: boolean;
}

export const EMPTY_LANDING_SEARCH: LandingSearchData = {
  hasData: false,
  bestRank: null,
  keywordsTracked: 0,
  topKeywords: [],
  pillar: null,
};

export const EMPTY_LANDING_ADS: LandingAdsData = {
  hasData: false,
  ownAdCount: 0,
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
  themes: [],
  competitors: [],
  pillar: null,
};

export const EMPTY_LANDING_WEBSITE: LandingWebsiteData = {
  hasData: false,
  websiteUrl: null,
  performance: null,
  seo: null,
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
  events: [],
  search: EMPTY_LANDING_SEARCH,
  adsDetail: EMPTY_LANDING_ADS,
  reviews: EMPTY_LANDING_REVIEWS,
  websiteDetail: EMPTY_LANDING_WEBSITE,
  fixes: [],
  lastSnapshotAt: null,
  hasAnyData: false,
};

/** The 12 website checks we grade, in display order. Labels are plain-English
 * (Maria's voice) — the DOM/Lighthouse booleans map onto these keys. */
export const LANDING_WEBSITE_CHECK_LABELS: { key: string; label: string }[] = [
  { key: "loadsFast", label: "Loads fast on phones" },
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
