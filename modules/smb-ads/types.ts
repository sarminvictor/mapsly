/**
 * SMB /ads · "Ads in your area" payload + pure logic.
 *
 * Maria-facing market intelligence, split into two FUNDAMENTALLY DIFFERENT
 * stories (the page renders them as two visually-distinct blocks):
 *
 *   • GOOGLE  — what it costs to show up in Search: keyword CPC/competition,
 *     who's outspending you (market leaderboard), and a budget simulator.
 *   • META    — who's winning on Facebook/Instagram: which platforms rivals
 *     run, their live creatives, and platform/creative suggestions.
 *
 * Data: DataForSEO (keyword costs + Google Ads Transparency, per business) +
 * our Meta Ad Library actor (per market CELL → AdMarketAdvertiser). Collected by
 * `modules/ads-intel` + the weekly crons.
 *
 * Pattern 1 (cache-components): `EMPTY_SMB_ADS` is the full shape so TS catches
 * partial returns at build (INC-25). Pure helpers live here so the query, the
 * client simulator, and the unit tests share one source of truth (no Prisma).
 */

export type CompetitionBucket = "LOW" | "MEDIUM" | "HIGH";
export type CompetitionLabel = "Low" | "Medium" | "High";

// ---- shared ----------------------------------------------------------------

export type AdSuggestionTone = "opportunity" | "gap" | "watch";

/** A "what to do next" card. The page resolves copy via
 *  `t(\`suggestion_${key}\`, params)` so this stays Prisma- + i18n-free. */
export interface AdSuggestion {
  key: string;
  tone: AdSuggestionTone;
  /** "google" | "meta" — which block (and which sidebar accent) it belongs to. */
  network: "google" | "meta";
  params: Record<string, string | number>;
}

// ---- GOOGLE block ----------------------------------------------------------

/** One row of the "what ads cost in your area" table. */
export interface AdKeywordCost {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: CompetitionBucket | null;
  competitionIndex: number | null;
  lowBid: number | null;
  highBid: number | null;
  /** Derived ranking score — higher = better opening. {@link opportunityScore} */
  opportunity: number;
}

/** One row of the "top Google advertisers in your market" leaderboard. */
export interface GoogleAdvertiserRow {
  id: string;
  name: string;
  rank: number;
  isOwn: boolean;
  /** Active Google creatives seen (Transparency). */
  adCount: number;
  domain: string | null;
}

export interface GoogleAdsBlock {
  /** Maria's own active Google ads. */
  ownAdCount: number;
  totalSearchVolume: number;
  avgCpc: number | null;
  competition: CompetitionLabel | null;
  bestOpportunity: AdKeywordCost | null;
  keywordCosts: AdKeywordCost[];
  /** Market-wide leaderboard (top spenders by active ad count). */
  topAdvertisers: GoogleAdvertiserRow[];
  advertiserCount: number;
  ownRank: number | null;
  suggestions: AdSuggestion[];
}

// ---- META block ------------------------------------------------------------

export interface MetaCreative {
  externalAdId: string;
  body: string | null;
  previewUrl: string | null;
  format: string | null;
  landingUrl: string | null;
  platforms: string[];
}

/** One advertiser in the Meta market (from AdMarketAdvertiser). */
export interface MetaAdvertiserCard {
  pageId: string;
  name: string;
  handle: string | null;
  isOwn: boolean;
  adCount: number;
  platforms: string[];
  runningSince: Date | null;
  creatives: MetaCreative[];
}

/** How many market advertisers run on each platform — the optimization signal. */
export interface MetaPlatformStat {
  platform: string; // FACEBOOK / INSTAGRAM / MESSENGER / AUDIENCE_NETWORK / THREADS
  advertisers: number;
  share: number; // 0..1 of advertisers using it
}

// ---- structured market analysis (replaces the old prose AI insights) -------

/** Format breakdown of the market's ads (deterministic, from displayFormat). */
export interface AdFormatStat {
  format: string; // "Video" | "Image" | "Carousel" | …
  ads: number;
  share: number; // 0..1
}
/** Which services the market advertises + whether Maria offers it (AI + her data). */
export interface MarketServiceStat {
  service: string;
  ads: number;
  share: number; // 0..1 of analyzed ads
  youOffer: boolean;
}
/** A promotional offer seen in the market (AI-extracted; price only if stated). */
export interface MarketPromo {
  label: string;
  offer: string;
  price: string | null;
}

export interface MetaAdsBlock {
  ownAdCount: number;
  ownPlatforms: string[];
  advertiserCount: number;
  totalActiveAds: number;
  platformSpread: MetaPlatformStat[];
  advertisers: MetaAdvertiserCard[];
  // structured "what's working" analysis
  formatMix: AdFormatStat[];
  serviceMix: MarketServiceStat[];
  promos: MarketPromo[];
  analyzedAt: Date | null;
  /** Personalized actions (compare her ads/services to the market). */
  suggestions: AdSuggestion[];
}

// ---- top-level payload -----------------------------------------------------

export interface SmbAdsData {
  ownedBusinessId: string;
  name: string;
  category: string;
  city: string;
  google: GoogleAdsBlock;
  meta: MetaAdsBlock;
  /** Curated sidebar actions (mix of google + meta), highest-impact first. */
  quickWins: AdSuggestion[];
  refreshedAt: Date | null;
  hasData: boolean;
}

export const EMPTY_GOOGLE_BLOCK: GoogleAdsBlock = {
  ownAdCount: 0,
  totalSearchVolume: 0,
  avgCpc: null,
  competition: null,
  bestOpportunity: null,
  keywordCosts: [],
  topAdvertisers: [],
  advertiserCount: 0,
  ownRank: null,
  suggestions: [],
};

export const EMPTY_META_BLOCK: MetaAdsBlock = {
  ownAdCount: 0,
  ownPlatforms: [],
  advertiserCount: 0,
  totalActiveAds: 0,
  platformSpread: [],
  advertisers: [],
  formatMix: [],
  serviceMix: [],
  promos: [],
  analyzedAt: null,
  suggestions: [],
};

/** Canonical empty shape — every field present (Pattern 1 / INC-25). */
export const EMPTY_SMB_ADS: SmbAdsData = {
  ownedBusinessId: "",
  name: "",
  category: "",
  city: "",
  google: EMPTY_GOOGLE_BLOCK,
  meta: EMPTY_META_BLOCK,
  quickWins: [],
  refreshedAt: null,
  hasData: false,
};

// ---- pure helpers ----------------------------------------------------------

/**
 * Opportunity score · higher = a better opening to advertise on. Rewards
 * demand + low competition, penalizes cost (Boxly's proven formula):
 *   volume × (100 − competitionIndex) / max(1, cpc × 10)
 */
export function opportunityScore(input: {
  searchVolume: number | null;
  cpc: number | null;
  competitionIndex: number | null;
}): number {
  const volume = input.searchVolume ?? 0;
  if (volume <= 0) return 0;
  const compIdx = input.competitionIndex ?? 50;
  const cpc = input.cpc ?? 0;
  const score = (volume * (100 - compIdx)) / Math.max(1, cpc * 10);
  return Math.round(score);
}

export function competitionLabelFromIndex(
  index: number | null,
): CompetitionLabel | null {
  if (index == null) return null;
  if (index < 34) return "Low";
  if (index < 67) return "Medium";
  return "High";
}

export function competitionLabelFromBucket(
  bucket: CompetitionBucket | null,
): CompetitionLabel | null {
  if (bucket === "LOW") return "Low";
  if (bucket === "MEDIUM") return "Medium";
  if (bucket === "HIGH") return "High";
  return null;
}

/**
 * Best opening: the highest-opportunity keyword that's actually winnable for an
 * SMB (not HIGH competition, real demand + cost). Falls back to top-opportunity.
 */
export function pickBestOpportunity(
  rows: readonly AdKeywordCost[],
): AdKeywordCost | null {
  if (rows.length === 0) return null;
  const winnable = rows.filter(
    (r) =>
      r.competition !== "HIGH" &&
      (r.searchVolume ?? 0) >= 100 &&
      (r.cpc ?? 0) > 0,
  );
  const pool = winnable.length > 0 ? winnable : rows;
  return [...pool].sort((a, b) => b.opportunity - a.opportunity)[0] ?? null;
}

function fmtUsd(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

// ---- suggestion builders (per block) ---------------------------------------

export interface GoogleSuggestionsInput {
  ownAdCount: number;
  advertiserCount: number; // rivals running Google ads
  bestOpportunity: AdKeywordCost | null;
  topAdvertiser: { name: string; adCount: number } | null;
}

/** Google block "what to do" — cost/keyword focused. Capped at 3. */
export function buildGoogleSuggestions(
  input: GoogleSuggestionsInput,
): AdSuggestion[] {
  const out: AdSuggestion[] = [];

  // Blue ocean: nobody advertises Google here AND we have a keyword to point at.
  if (
    input.ownAdCount === 0 &&
    input.advertiserCount === 0 &&
    input.bestOpportunity
  ) {
    out.push({
      key: "g_blue_ocean",
      tone: "opportunity",
      network: "google",
      params: {
        keyword: input.bestOpportunity.keyword,
        cpc: fmtUsd(input.bestOpportunity.cpc),
      },
    });
  }
  // The cheapest winnable keyword to start on.
  if (input.bestOpportunity) {
    out.push({
      key: "g_start_here",
      tone: "opportunity",
      network: "google",
      params: {
        keyword: input.bestOpportunity.keyword,
        cpc: fmtUsd(input.bestOpportunity.cpc),
        competition:
          competitionLabelFromBucket(input.bestOpportunity.competition) ??
          "Low",
      },
    });
  }
  // Gap: rivals run Google ads, you don't.
  if (input.ownAdCount === 0 && input.advertiserCount > 0) {
    out.push({
      key: "g_gap",
      tone: "gap",
      network: "google",
      params: { count: input.advertiserCount },
    });
  }
  // Watch the top Google spender.
  if (input.topAdvertiser) {
    out.push({
      key: "g_watch",
      tone: "watch",
      network: "google",
      params: {
        name: input.topAdvertiser.name,
        count: input.topAdvertiser.adCount,
      },
    });
  }
  return out.slice(0, 3);
}

/** Fringe Meta surfaces — low-value for a local SMB vs. Facebook + Instagram. */
const FRINGE_META_PLATFORMS = new Set([
  "MESSENGER",
  "WHATSAPP",
  "AUDIENCE_NETWORK",
]);

export interface PersonalMetaInput {
  ownAdCount: number;
  ownPlatforms: string[];
  advertiserCount: number;
  /** Maria's own services (BusinessService) — drives the "win" gap. */
  ownServices: readonly string[];
  formatMix: readonly AdFormatStat[];
  serviceMix: readonly MarketServiceStat[];
  promos: readonly MarketPromo[];
}

/**
 * PERSONALIZED Meta actions — compares Maria's situation (her services, her own
 * ads, her platforms) to the market analysis. Deterministic + testable; the
 * page resolves copy via `t(\`suggestion_${key}\`, params)`. Capped at 4.
 */
export function buildPersonalizedMetaSuggestions(
  input: PersonalMetaInput,
): AdSuggestion[] {
  const out: AdSuggestion[] = [];

  // 1 · She's not on Meta at all, but the market is → start.
  if (input.ownAdCount === 0 && input.advertiserCount > 0) {
    out.push({
      key: "m_start",
      tone: "gap",
      network: "meta",
      params: { count: input.advertiserCount },
    });
  }

  // 2 · Service WIN — services she offers that the market barely advertises
  // (≤10% of ads, or absent entirely). Easy openings.
  const advertisedShare = new Map(
    input.serviceMix.map((s) => [s.service.toLowerCase(), s.share]),
  );
  const winServices = input.ownServices
    .filter((svc) => (advertisedShare.get(svc.toLowerCase()) ?? 0) <= 0.1)
    .slice(0, 3);
  if (winServices.length > 0) {
    out.push({
      key: "m_service_win",
      tone: "opportunity",
      network: "meta",
      params: { services: winServices.join(", ") },
    });
  }

  // 3 · Platform TRIM — she runs on fringe surfaces (Messenger / WhatsApp /
  // Audience Network) that few local SMBs benefit from → focus FB + IG.
  if (input.ownAdCount > 0) {
    const fringe = input.ownPlatforms
      .filter((p) => FRINGE_META_PLATFORMS.has(p.toUpperCase()))
      .map(platformLabel);
    if (fringe.length > 0) {
      out.push({
        key: "m_platform_trim",
        tone: "opportunity",
        network: "meta",
        params: { platforms: fringe.join(", ") },
      });
    }
  }

  // 4 · Promo benchmark — the going rate, so she can price competitively.
  const priced = input.promos.find((p) => p.price);
  if (priced) {
    out.push({
      key: "m_promo_benchmark",
      tone: "watch",
      network: "meta",
      params: { offer: priced.offer, price: priced.price ?? "" },
    });
  }

  // 5 · Format — market is video-heavy → use video.
  const video = input.formatMix.find((f) => /video/i.test(f.format));
  if (video && video.share >= 0.4) {
    out.push({
      key: "m_format_video",
      tone: "opportunity",
      network: "meta",
      params: { pct: Math.round(video.share * 100) },
    });
  }

  return out.slice(0, 4);
}

/** Human label for a Meta publisher platform. */
export function platformLabel(p: string): string {
  switch (p.toUpperCase()) {
    case "FACEBOOK":
      return "Facebook";
    case "INSTAGRAM":
      return "Instagram";
    case "MESSENGER":
      return "Messenger";
    case "AUDIENCE_NETWORK":
      return "Audience Network";
    case "THREADS":
      return "Threads";
    case "WHATSAPP":
      return "WhatsApp";
    default:
      return p;
  }
}

// ---- budget simulator (pure · shared with the client component) ------------

/** Home-services benchmarks (LocaliQ 2025). Single source of truth. */
export const BENCHMARK_CTR = 0.0637;
export const BENCHMARK_CVR = 0.0733;

function ctrForCompetition(bucket: CompetitionBucket | null): number {
  const mult = bucket === "LOW" ? 1.4 : bucket === "HIGH" ? 0.7 : 1.0;
  return BENCHMARK_CTR * mult;
}

export interface BudgetAllocation {
  keyword: string;
  spend: number;
  clicks: number;
}

export interface BudgetSimulation {
  spend: number;
  unspent: number;
  clicks: number;
  leads: number;
  effectiveCpc: number;
  costPerLead: number;
  allocations: BudgetAllocation[];
}

/**
 * Spread a monthly budget across the best keywords (greedy by opportunity),
 * capped at each keyword's monthly click capacity, and estimate clicks → leads.
 * Pure; shared by the client simulator + unit tests.
 */
export function simulateAdBudget(
  rows: readonly AdKeywordCost[],
  budget: number,
): BudgetSimulation {
  const empty: BudgetSimulation = {
    spend: 0,
    unspent: Math.max(0, budget),
    clicks: 0,
    leads: 0,
    effectiveCpc: 0,
    costPerLead: 0,
    allocations: [],
  };
  if (budget <= 0) return empty;

  const usable = rows
    .filter((r) => (r.cpc ?? 0) > 0 && (r.searchVolume ?? 0) > 0)
    .sort((a, b) => b.opportunity - a.opportunity);
  if (usable.length === 0) return empty;

  let remaining = budget;
  let totalClicks = 0;
  let totalSpend = 0;
  const allocations: BudgetAllocation[] = [];

  for (const r of usable) {
    if (remaining <= 0) break;
    const cpc = r.cpc ?? 0;
    const ctr = ctrForCompetition(r.competition);
    const monthlyClickCapacity = Math.max(
      1,
      Math.round((r.searchVolume ?? 0) * ctr),
    );
    const affordableClicks = Math.floor(remaining / cpc);
    const clicks = Math.min(monthlyClickCapacity, affordableClicks);
    if (clicks <= 0) continue;
    const spend = Math.round(clicks * cpc);
    allocations.push({ keyword: r.keyword, spend, clicks });
    totalClicks += clicks;
    totalSpend += spend;
    remaining -= spend;
  }

  const leads = Math.round(totalClicks * BENCHMARK_CVR);
  return {
    spend: totalSpend,
    unspent: Math.max(0, budget - totalSpend),
    clicks: totalClicks,
    leads,
    effectiveCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    costPerLead: leads > 0 ? totalSpend / leads : 0,
    allocations,
  };
}

/** Curate the sidebar quick-wins: highest-impact suggestions across blocks,
 *  opportunity > gap > watch, google + meta interleaved. Capped at 4. */
export function curateQuickWins(
  google: readonly AdSuggestion[],
  meta: readonly AdSuggestion[],
): AdSuggestion[] {
  const toneRank: Record<AdSuggestionTone, number> = {
    opportunity: 0,
    gap: 1,
    watch: 2,
  };
  return [...google, ...meta]
    .sort((a, b) => toneRank[a.tone] - toneRank[b.tone])
    .slice(0, 4);
}
