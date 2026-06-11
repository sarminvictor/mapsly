/**
 * Personalization tokens for cold copy — pulled from Mapsly's own signals.
 * All values are strings ("" when absent) so the template engine's {{#if}}
 * guards work. The killer cold hook is the recipient's OWN business data.
 *
 * Signal tokens (Miami launch · 2026-06):
 *   websiteSlowSeconds — mobile LCP rounded, ONLY when ≥ 4s (below that the
 *     site isn't slow enough to be a credible hook).
 *   localRankHint — "page 2" / "page 3 or deeper", ONLY when the business is
 *     genuinely invisible (no organic rank ≤ 10, no Maps 3-pack spot, ≥ 3
 *     tracked keywords so it isn't a data artifact). Never populated for
 *     page-1 businesses — a wrong claim burns the sender.
 *   topCompetitorName — modal pack1Name across fresh MAPS scans of the
 *     business's own tracked keywords, excluding itself. Populated ONLY when
 *     localRankHint is also populated (verified-outranked invariant).
 *   competitorAdsCount — same-cell competitors with active Google ads
 *     (Ads Transparency via AdLibraryEntry), ONLY when the recipient runs
 *     none themselves and ≥ 2 competitors do. Meta cell data not collected
 *     for Miami yet — copy must say "ads on Google", not FB/IG.
 */
import prisma from "@/lib/prisma";

/** Pack-name noise guard: pack names match loosely (case/punct-insensitive). */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "" unless the site is slow enough (≥ 4s mobile LCP) to be a credible hook. */
export function slowSecondsFromLcp(lcp: number | null): string {
  if (lcp == null || lcp < 4) return "";
  return String(Math.round(lcp));
}

/**
 * "" unless genuinely invisible: ≥ 3 tracked keywords, no organic rank ≤ 10,
 * no Maps 3-pack spot. Never populated for page-1 businesses.
 */
export function rankHint(
  trackedKeywords: number,
  bestOrganic: number | null,
  bestMaps: number | null,
): string {
  const invisible =
    trackedKeywords >= 3 &&
    (bestOrganic == null || bestOrganic > 10) &&
    (bestMaps == null || bestMaps > 3);
  if (!invisible) return "";
  return bestOrganic != null && bestOrganic <= 20
    ? "page 2"
    : "page 3 or deeper";
}

export interface BuildTokensOptions {
  reportUrl: string;
  /** Sign-off name — matches the From display of the chosen mailbox. */
  senderName: string;
}

export async function buildTokens(
  businessId: string | null,
  opts: BuildTokensOptions,
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {
    reportUrl: opts.reportUrl,
    senderFirstName: opts.senderName,
    businessName: "there",
    city: "",
    rating: "",
    reviewCount: "",
    unansweredCount: "",
    unansweredOneStar: "",
    websiteSlowSeconds: "",
    localRankHint: "",
    topCompetitorName: "",
    competitorAdsCount: "",
  };
  if (!businessId) return tokens;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      city: true,
      category: true,
      rating: true,
      reviewCount: true,
      lighthouseAudits: {
        take: 1,
        orderBy: { auditedAt: "desc" },
        select: { lcp: true },
      },
      businessKeywords: {
        select: {
          keywordId: true,
          latestOrganicRank: true,
          latestMapsRank: true,
        },
      },
      adLibraryEntries: {
        where: { isActive: true },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (business) {
    tokens.businessName = business.name;
    tokens.city = business.city ?? "";
    tokens.rating = business.rating != null ? business.rating.toFixed(1) : "";
    tokens.reviewCount =
      business.reviewCount != null ? String(business.reviewCount) : "";
  }

  const [unanswered, unansweredOne] = await Promise.all([
    prisma.review.count({ where: { businessId, ownerReplied: false } }),
    prisma.review.count({
      where: { businessId, ownerReplied: false, stars: { lte: 2 } },
    }),
  ]);
  tokens.unansweredCount = unanswered > 0 ? String(unanswered) : "";
  tokens.unansweredOneStar = unansweredOne > 0 ? String(unansweredOne) : "";

  if (!business) return tokens;

  // websiteSlowSeconds · mobile LCP, only when slow enough to be a hook.
  tokens.websiteSlowSeconds = slowSecondsFromLcp(
    business.lighthouseAudits[0]?.lcp ?? null,
  );

  // localRankHint · only when genuinely invisible across ≥ 3 tracked keywords.
  const kws = business.businessKeywords;
  const organicRanks = kws
    .map((k) => k.latestOrganicRank)
    .filter((r): r is number => r != null);
  const mapsRanks = kws
    .map((k) => k.latestMapsRank)
    .filter((r): r is number => r != null);
  const bestOrganic = organicRanks.length ? Math.min(...organicRanks) : null;
  const bestMaps = mapsRanks.length ? Math.min(...mapsRanks) : null;
  tokens.localRankHint = rankHint(kws.length, bestOrganic, bestMaps);
  if (tokens.localRankHint) {
    // topCompetitorName · verified-outranked invariant: only alongside
    // localRankHint. Modal pack1Name across fresh MAPS scans of this
    // business's own tracked keywords, excluding itself.
    const keywordIds = kws.map((k) => k.keywordId);
    if (keywordIds.length > 0) {
      const packRows = await prisma.serpResult.findMany({
        where: {
          keywordId: { in: keywordIds },
          kind: "MAPS",
          pack1Name: { not: null },
          scannedAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
        },
        orderBy: { scannedAt: "desc" },
        take: 100,
        select: { pack1Name: true },
      });
      const self = normalizeName(business.name);
      const counts = new Map<string, { name: string; n: number }>();
      for (const row of packRows) {
        const name = row.pack1Name;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!norm || norm === self) continue;
        const entry = counts.get(norm) ?? { name, n: 0 };
        entry.n += 1;
        counts.set(norm, entry);
      }
      let top: { name: string; n: number } | null = null;
      for (const entry of counts.values()) {
        if (!top || entry.n > top.n) top = entry;
      }
      // ≥ 2 sightings so one odd scan can't name the wrong rival.
      if (top && top.n >= 2) tokens.topCompetitorName = top.name;
    }
  }

  // competitorAdsCount · same-cell rivals with active Google ads, only when
  // the recipient runs none themselves.
  const runsOwnAds = business.adLibraryEntries.length > 0;
  if (!runsOwnAds && business.city && business.category) {
    const rivals = await prisma.adLibraryEntry.findMany({
      where: {
        isActive: true,
        businessId: { not: businessId },
        business: { city: business.city, category: business.category },
      },
      select: { businessId: true },
      distinct: ["businessId"],
      take: 25,
    });
    if (rivals.length >= 2) tokens.competitorAdsCount = String(rivals.length);
  }

  return tokens;
}
