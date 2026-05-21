/**
 * SMB search visibility · server query.
 *
 * Surface: `getSmbSearchData(userId)` — returns the user's own
 * business + a per-keyword visibility view (latest local-pack rank,
 * organic rank, week-over-week delta) for the `/(smb)/search` route.
 * Returns the EMPTY shape (`ownedBusinessId === ""`) when:
 *
 *   - the user has no claimed business yet (post-signup / onboarding)
 *   - we're in Vercel's build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrades to "looks empty" rather than 500 crash)
 *
 * The page handler reads `data.ownedBusinessId === ""` and renders an
 * onboarding-style empty state (Maria's first visit).
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('hours')` — SERP scans land on a
 *     weekly cron (C.9). Hours-fresh is plenty since the upstream cron
 *     also `revalidateTag`s this tag after the snapshot batch lands.
 *   - `cacheTag('smb-search-${userId}')` — per-user, so a user-facing
 *     business profile change can revalidate only the affected user.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the EMPTY shape is
 * the full shape of the declared return type — TypeScript catches
 * partial returns at literal-comparison time. Build-phase short-circuit
 * + catch block both return EMPTY so the page prerenders cleanly even
 * when the Vercel build worker can't open a Neon WebSocket.
 *
 * Per `.claude/rules/performance.md` + INC-37, `select`s are explicit
 * (no bare `include`). The query path fetches the user's business +
 * its SerpResult rows scoped to a recent window in a single round-trip
 * via Prisma relation `select`, then groups in memory by keyword to
 * pick "latest" and "previous-week" per keyword — fewer keywords are
 * tracked per business than there are scans, so this is cheap.
 *
 * Per `.claude/rules/security.md`, this helper does NOT enforce auth —
 * the page handler is responsible for `unauthorized()`. This function
 * just runs queries scoped to the userId it's given.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_SMB_SEARCH,
  MAX_KEYWORDS,
  type KeywordRow,
  type SmbSearchData,
} from "./types";

/**
 * Internal helper · pick the latest scan and the previous-week scan
 * for a single keyword from a list of scans for that keyword. Returns
 * `[latest, previous]` where `previous` is the most recent scan ≥ 6
 * days older than `latest`, or `null` if none exists.
 *
 * The 6-day window means a fresh weekly cron run + last week's run
 * resolve as `latest` vs `previous`. A mid-week ad-hoc rescan won't be
 * mistaken for "last week".
 */
function pickLatestAndPrev(
  scans: Array<{
    scannedAt: Date;
    localPackRank: number | null;
    organicRank: number | null;
  }>,
): [(typeof scans)[number] | null, (typeof scans)[number] | null] {
  if (scans.length === 0) return [null, null];
  // Scans arrive sorted desc by scannedAt (Prisma orderBy below).
  const latest = scans[0];
  const cutoffMs = latest.scannedAt.getTime() - 6 * 24 * 60 * 60 * 1000;
  let previous: (typeof scans)[number] | null = null;
  for (let i = 1; i < scans.length; i++) {
    if (scans[i].scannedAt.getTime() <= cutoffMs) {
      previous = scans[i];
      break;
    }
  }
  return [latest, previous];
}

/**
 * Sort rule · in-local-pack rows first (best rank first), then rows
 * with an organic rank (best first), then everything else by keyword
 * search volume desc. Maria's eye scans top-to-bottom, so the
 * highest-value visible wins come first.
 */
function rankRows(a: KeywordRow, b: KeywordRow): number {
  const aInPack = a.localPackRank != null;
  const bInPack = b.localPackRank != null;
  if (aInPack && bInPack) {
    return (a.localPackRank ?? 99) - (b.localPackRank ?? 99);
  }
  if (aInPack) return -1;
  if (bInPack) return 1;

  const aHasOrg = a.organicRank != null;
  const bHasOrg = b.organicRank != null;
  if (aHasOrg && bHasOrg) {
    return (a.organicRank ?? 999) - (b.organicRank ?? 999);
  }
  if (aHasOrg) return -1;
  if (bHasOrg) return 1;

  return (b.searchVolume ?? 0) - (a.searchVolume ?? 0);
}

export async function getSmbSearchData(userId: string): Promise<SmbSearchData> {
  "use cache";
  cacheLife("hours");
  cacheTag(`smb-search-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_SEARCH;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_SEARCH;
  }

  try {
    // 1) Fetch the user's own business + the last ~60 days of SerpResults
    //    in one round-trip. Per INC-37, explicit `select` only — no
    //    bare `include`. Per `.claude/rules/performance.md`, narrow
    //    fields aggressively.
    //
    //    We fetch up to 200 recent scans to safely cover ~25 keywords ×
    //    ~8 weeks of weekly cadence; the cron only stores latest few
    //    per keyword anyway.
    const own = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        city: true,
        serpResults: {
          orderBy: { scannedAt: "desc" },
          take: 200,
          select: {
            keywordId: true,
            scannedAt: true,
            localPackRank: true,
            organicRank: true,
            keyword: {
              select: {
                id: true,
                keyword: true,
                searchVolume: true,
              },
            },
          },
        },
      },
    });

    if (!own) {
      return EMPTY_SMB_SEARCH;
    }

    // 2) Group scans by keywordId so we can pick latest + previous-week
    //    per keyword.
    type Scan = (typeof own.serpResults)[number];
    const byKeyword = new Map<string, Scan[]>();
    for (const s of own.serpResults) {
      const list = byKeyword.get(s.keywordId);
      if (list) list.push(s);
      else byKeyword.set(s.keywordId, [s]);
    }

    const rows: KeywordRow[] = [];
    let mostRecentScanMs: number | null = null;

    for (const [, scans] of byKeyword) {
      // Scans within each group inherit the outer desc order.
      const [latest, previous] = pickLatestAndPrev(scans);
      if (!latest) continue;
      const kw = latest.keyword;
      if (!kw) continue;

      rows.push({
        id: kw.id,
        keyword: kw.keyword,
        searchVolume: kw.searchVolume,
        localPackRank: latest.localPackRank,
        organicRank: latest.organicRank,
        prevLocalPackRank: previous?.localPackRank ?? null,
        prevOrganicRank: previous?.organicRank ?? null,
        scannedAt: latest.scannedAt,
      });

      const ms = latest.scannedAt.getTime();
      if (mostRecentScanMs === null || ms > mostRecentScanMs) {
        mostRecentScanMs = ms;
      }
    }

    // 3) Sort + trim to the table cap.
    rows.sort(rankRows);
    const visible = rows.slice(0, MAX_KEYWORDS);

    // 4) Derive hero KPIs from the FULL set of rows (not just visible)
    //    so the "keywords tracked" count is honest even when the table
    //    is trimmed.
    let bestLocalPackRank: number | null = null;
    let keywordsInLocalPack = 0;
    let keywordsImproved = 0;
    for (const r of rows) {
      if (r.localPackRank != null) {
        keywordsInLocalPack += 1;
        if (bestLocalPackRank === null || r.localPackRank < bestLocalPackRank) {
          bestLocalPackRank = r.localPackRank;
        }
      }
      // "Improved" = either local or organic rank got smaller (better)
      // vs the previous-week scan. Rows with no prev scan don't count.
      const localImproved =
        r.prevLocalPackRank != null &&
        r.localPackRank != null &&
        r.localPackRank < r.prevLocalPackRank;
      const orgImproved =
        r.prevOrganicRank != null &&
        r.organicRank != null &&
        r.organicRank < r.prevOrganicRank;
      // Also count "wasn't ranked, now is" as improvement.
      const newlyLocal = r.prevLocalPackRank == null && r.localPackRank != null;
      const newlyOrg = r.prevOrganicRank == null && r.organicRank != null;
      if (localImproved || orgImproved || newlyLocal || newlyOrg) {
        keywordsImproved += 1;
      }
    }

    return {
      ownedBusinessId: own.id,
      name: own.name,
      city: own.city,
      bestLocalPackRank,
      keywordsTracked: rows.length,
      keywordsInLocalPack,
      keywordsImprovedThisWeek: keywordsImproved,
      keywords: visible,
      lastScanAt: mostRecentScanMs != null ? new Date(mostRecentScanMs) : null,
    };
  } catch (err) {
    // Per `.claude/rules/observability.md`, surface Prisma failures to
    // the server log so Sentry's autoinstrumented handler picks them
    // up. The page still renders the EMPTY shape gracefully.
    console.error("getSmbSearchData failed", err);
    return EMPTY_SMB_SEARCH;
  }
}
