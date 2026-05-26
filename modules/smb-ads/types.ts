/**
 * SMB ads · payload type definitions and pure-logic helpers.
 *
 * `SmbAdsData` is the flat shape the `/(smb)/ads` page renders from. It
 * bundles Maria's own business identity + the active competitor / own-
 * business ads we've spotted, grouped into 14-keyword lanes per the
 * task description.
 *
 * `EMPTY_SMB_ADS` is the build-phase / no-biz / error short-circuit
 * shape per `.claude/rules/cache-components.md` Pattern 1 — every field
 * of the interface is present so TypeScript catches partial returns
 * at literal-comparison time on Vercel build (see INC-25).
 *
 * The two helpers (`isOffKeyword`, `groupIntoLanes`) are pure functions
 * exported from this module so the unit test in `__tests__/` can import
 * them without pulling in Prisma — keeps tests fast and side-effect
 * free per `.claude/rules/testing.md`.
 */

/**
 * Platform enum mirroring `AdPlatform` from Prisma. Re-declared here as
 * a string literal union so this types module stays free of Prisma
 * imports (lets the pure helpers + tests run without the generated
 * client). The page's query layer narrows from `AdPlatform` to this
 * union at the read boundary.
 */
export type SmbAdPlatform = "META" | "GOOGLE";

/**
 * Single competitor ad creative. Shape matches what the page can
 * render — only the fields surfaced to Maria are kept; spend / target
 * fields are deliberately omitted because they're noise for the SMB
 * audience per `.claude/rules/ui-ux-smb.md`.
 */
export interface AdEntry {
  /** Stable identifier (AdLibraryEntry.id). React key. */
  id: string;
  /** Which ad network this came from. */
  platform: SmbAdPlatform;
  /** Ad copy body. Nullable when we have a record of the ad but no
   * captured creative text yet (often during the first refresh). */
  adCreativeBody: string | null;
  /** Landing URL the ad clicks through to. Nullable when not parsed. */
  landingUrl: string | null;
  /** When we last saw this ad active. Used for the lane's "last seen"
   * footer + the page-level "refreshed" header. */
  lastSeenAt: Date;
  /** Owning business name · null when this is Maria's own ad. The UI
   * renders "{advertiser} · {timeAgo}" for competitor ads, just
   * "{timeAgo}" for own ads. */
  advertiserName: string | null;
  /** True iff this is Maria's own ad (vs a competitor's). Drives a
   * subtle visual distinction in the card. */
  isOwn: boolean;
}

/**
 * One keyword lane. The lane key is the matched keyword string we used
 * to surface these ads. The "unmatched" lane (`__unmatched__`) groups
 * ads where the cron couldn't tie the creative to any of Maria's
 * tracked keywords — these are flagged off-services by definition.
 *
 * `isOffKeyword` is computed up-front by the query layer so the
 * component doesn't have to re-derive it. A lane is off-keyword when:
 *   - keyword is the `__unmatched__` sentinel, OR
 *   - no service string in Maria's `Business.categories` overlaps
 *     (substring, case-insensitive) with the keyword.
 *
 * **Competitor intel (PR · Ads competitor intel):** in addition to
 * Maria's own ads, lanes now carry counts + names from competitor
 * businesses in the same `category` + `city`. `status` makes the
 * competitive picture scannable:
 *
 *   - `open`        · 0 competitor ads, 0 own ads → blue-ocean lane
 *   - `you-absent`  · ≥ 1 competitor ad, 0 own ads → "they're spending, you're not"
 *   - `present`     · own ads present, ≤ 2 competitors total in lane
 *   - `crowded`     · ≥ 3 competitor ads → tough lane regardless of your presence
 */
export type AdLaneStatus = "open" | "you-absent" | "present" | "crowded";

export interface AdLane {
  /** Lane key. `__unmatched__` for the "couldn't match" bucket;
   * a plain keyword string otherwise. */
  keyword: string;
  /** All ads in this lane — own + competitor. Capped per
   * MAX_ADS_PER_LANE_VISIBLE in the UI; full list kept here so the
   * page can show a "+N more" footer with an honest count. */
  ads: AdEntry[];
  /** Whether the lane should render with the off-service warning chip
   * + coral-tinted border (per `.claude/rules/ui-ux-smb.md` —
   * redundant cues, never color alone). */
  isOffKeyword: boolean;
  /** Count of Maria's own ads in this lane. */
  ownCount: number;
  /** Count of distinct competitor businesses with at least one ad in
   * this lane. NOT the count of competitor ads (a single competitor
   * with 4 creatives counts as 1). */
  competitorCount: number;
  /** Up to 3 competitor business names sorted by ad count (most
   * advertised first). Empty when no competitors are running ads. */
  topCompetitors: string[];
  /** Computed status. See `AdLaneStatus`. */
  status: AdLaneStatus;
}

/**
 * Top-level page payload. The page reads:
 *   - `ownedBusinessId === ""` → onboarding empty state
 *   - `lanes.length === 0`     → "no ads we've spotted yet" state
 *   - otherwise               → the lane grid
 */
export interface SmbAdsData {
  /** Owned business id, or `""` for empty / build-phase. */
  ownedBusinessId: string;
  /** Owned business display name. */
  name: string;
  /** Owned business primary category. */
  category: string;
  /** Total active ads — Maria's own only. Used in "Your active ads". */
  totalActiveAds: number;
  /** Total ads in off-keyword lanes (own only). Used in "Ads off your
   * services" + to gate the warning alert. */
  offKeywordCount: number;
  /** Count of lanes where Maria has ≥ 1 own ad. */
  lanesCovered: number;
  /** Count of lanes where 0 ads are running (own + competitor) and the
   * keyword is on-service for Maria — "blue ocean" opportunities. */
  openLanes: number;
  /** Distinct competitor businesses we've seen ads from in this market
   * across all lanes. Used in the "Who else is advertising" KPI. */
  competitorCount: number;
  /** Lanes, ordered by ad count descending (most-active first). */
  lanes: AdLane[];
  /** Most recent `lastSeenAt` across all ads. Used in the "Refreshed"
   * footer. Nullable for new / empty businesses. */
  refreshedAt: Date | null;
}

/**
 * Canonical empty shape — every field present so TypeScript catches
 * shape drift at compile time (INC-25). Returned by `getSmbAdsData`
 * during Vercel build, when the user has no claimed business, or when
 * Prisma errors.
 */
export const EMPTY_SMB_ADS: SmbAdsData = {
  ownedBusinessId: "",
  name: "",
  category: "",
  totalActiveAds: 0,
  offKeywordCount: 0,
  lanesCovered: 0,
  openLanes: 0,
  competitorCount: 0,
  lanes: [],
  refreshedAt: null,
};

/** Sentinel keyword for the "ads we couldn't match to any of your
 * tracked keywords" bucket. */
export const UNMATCHED_KEYWORD = "__unmatched__";

/**
 * Max number of lanes the page shows. Per the task description ("14-
 * keyword lane grid") and `.claude/rules/ui-ux-smb.md` which caps
 * information density on Maria's surfaces.
 */
export const MAX_LANES = 14;

/**
 * Max number of ads rendered inline per lane (before "+N more" tail).
 * Three keeps each lane card scannable on mobile (380px).
 */
export const MAX_ADS_PER_LANE_VISIBLE = 3;

/**
 * Whether a keyword is "off-services" — i.e. doesn't seem to match
 * Maria's `Business.categories`. Pure function, no IO, used by both
 * the query layer (to flag lanes) and the unit test.
 *
 * Rules (each is an OR — any one trips off-keyword):
 *   - `keyword` is null / empty / the UNMATCHED_KEYWORD sentinel
 *   - `services` is empty (no services to compare against → can't
 *     vouch, default to off — we'd rather show a chip than silently
 *     mis-classify)
 *   - No service string is a case-insensitive substring of the
 *     keyword (or vice-versa)
 *
 * Substring match is intentional — Maria's `categories` are things
 * like `["botox", "filler", "facials"]` while ad keywords are things
 * like `"botox specials brickell"`. We want the lane "botox specials
 * brickell" to be ON-services for a botox spa.
 */
export function isOffKeyword(
  keyword: string | null | undefined,
  services: readonly string[],
): boolean {
  if (keyword == null) return true;
  const trimmed = keyword.trim();
  if (trimmed === "" || trimmed === UNMATCHED_KEYWORD) return true;
  if (!services || services.length === 0) return true;
  const lowered = trimmed.toLowerCase();
  for (const svc of services) {
    if (svc == null) continue;
    const s = String(svc).trim().toLowerCase();
    if (s === "") continue;
    if (lowered.includes(s) || s.includes(lowered)) return false;
  }
  return true;
}

/**
 * Group a flat list of ads into lanes keyed by `matchedKeyword`. Pure
 * function: no IO, no Prisma. Returned lanes are ordered by ad count
 * descending (most-active first), then by keyword alphabetically as a
 * stable tie-breaker so the page render is deterministic.
 *
 * The "unmatched" bucket — ads whose `matchedKeyword` is null / empty
 * — collapses to a single lane keyed by `UNMATCHED_KEYWORD`. It always
 * carries `isOffKeyword: true`.
 *
 * Truncates to `maxLanes` lanes so we never blow past the page's
 * density cap (Maria-friendly, per `.claude/rules/ui-ux-smb.md`).
 */
export function groupIntoLanes(
  ads: readonly AdEntry[],
  services: readonly string[],
  maxLanes: number,
  rawKeywords?: ReadonlyArray<string | null | undefined>,
): AdLane[] {
  if (!ads || ads.length === 0) return [];
  if (maxLanes <= 0) return [];

  const buckets = new Map<string, AdEntry[]>();
  ads.forEach((ad, idx) => {
    // Prefer the explicit keyword array if the caller passed one
    // (the query layer does — it gets the matchedKeyword off the
    // raw Prisma row before normalising to AdEntry, which doesn't
    // carry the keyword itself).
    const raw = rawKeywords?.[idx];
    const key = !raw || raw.trim() === "" ? UNMATCHED_KEYWORD : raw.trim();
    const list = buckets.get(key);
    if (list) {
      list.push(ad);
    } else {
      buckets.set(key, [ad]);
    }
  });

  const lanes: AdLane[] = [];
  for (const [keyword, laneAds] of buckets.entries()) {
    lanes.push(deriveLaneStats(keyword, laneAds, services));
  }

  lanes.sort((a, b) => {
    // Most-active first; alphabetical fallback.
    if (b.ads.length !== a.ads.length) return b.ads.length - a.ads.length;
    return a.keyword.localeCompare(b.keyword);
  });

  return lanes.slice(0, maxLanes);
}

/**
 * Derive the full lane shape (counts, top advertisers, status) from a
 * keyword + its ads. Pure; tested via `__tests__/types.test.ts`.
 *
 * Status rules — first match wins:
 *   - `competitorCount >= 3`  → `crowded`
 *   - `competitorCount >= 1` and `ownCount === 0` → `you-absent`
 *   - `ownCount >= 1`         → `present`
 *   - else (no ads at all)    → `open`
 */
export function deriveLaneStats(
  keyword: string,
  laneAds: readonly AdEntry[],
  services: readonly string[],
): AdLane {
  let ownCount = 0;
  const competitorAdCounts = new Map<string, number>();

  for (const ad of laneAds) {
    if (ad.isOwn) {
      ownCount++;
      continue;
    }
    const name = ad.advertiserName?.trim();
    if (!name) continue;
    competitorAdCounts.set(name, (competitorAdCounts.get(name) ?? 0) + 1);
  }

  const competitorCount = competitorAdCounts.size;
  const topCompetitors = Array.from(competitorAdCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([n]) => n);

  let status: AdLaneStatus;
  if (competitorCount >= 3) status = "crowded";
  else if (competitorCount >= 1 && ownCount === 0) status = "you-absent";
  else if (ownCount >= 1) status = "present";
  else status = "open";

  return {
    keyword,
    ads: [...laneAds],
    isOffKeyword: isOffKeyword(keyword, services),
    ownCount,
    competitorCount,
    topCompetitors,
    status,
  };
}

/**
 * Paradox detection · returns the alert label tier when Maria is
 * "spending without showing up" — many own ads but few covered lanes
 * relative to what's available in her market.
 *
 *   - `high`  · totalActiveAds ≥ 5 AND lanesCovered / max(1, totalLanes) < 0.25
 *   - `medium`· totalActiveAds ≥ 1 AND lanesCovered / max(1, totalLanes) < 0.5
 *   - null    · otherwise
 *
 * The component renders a coral alert for `high`, a gold alert for
 * `medium`, nothing for null.
 */
export type ParadoxTier = "high" | "medium" | null;

export function detectParadoxTier(input: {
  totalActiveAds: number;
  lanesCovered: number;
  totalLanes: number;
}): ParadoxTier {
  const { totalActiveAds, lanesCovered, totalLanes } = input;
  if (totalActiveAds === 0) return null;
  const denom = Math.max(1, totalLanes);
  const ratio = lanesCovered / denom;
  if (totalActiveAds >= 5 && ratio < 0.25) return "high";
  if (ratio < 0.5) return "medium";
  return null;
}
