/**
 * SMB weekly overview · server query.
 *
 * `getSmbHomeData(userId)` returns everything the consolidated `/home`
 * page renders: the owner's Mapsly Score + market standing, the 5 section
 * scores, quick wins across every section, the full market competitor
 * table (ranked by Mapsly Score, with a weekly rank-movement column), and
 * the "this week — what changed" events feed.
 *
 * Reads only from `BusinessSnapshot` (latest + prior weekly rows in the
 * owner's `cellKey` market) + a couple of cheap counts — no external API
 * calls (`.claude/rules/cost-discipline.md`), no N+1.
 *
 * Cache: `'use cache'` + `cacheLife('minutes')` + `cacheTag('smb-home-${userId}')`
 * per `.claude/rules/caching.md`. Cron revalidates on snapshot writes.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the NEXT_PHASE guard
 * returns EMPTY (full shape) so Vercel's build worker prerenders without a
 * Neon WebSocket.
 *
 * The pillar-score rank delta warms up: it diffs this week's live cell rank
 * against last week's stored `pillarRanks.master` (written by the pillar-score
 * pass). Until two comparable weeks exist it renders "new" — see the design
 * note in `.claude/loop.md`-era decision "ship now, Δ warms up".
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import { deriveOverviewFixes } from "./derive";
import {
  type BizWeek,
  type SnapshotSignals,
  deriveMarketChanges,
} from "./events";
import {
  EMPTY_SMB_OVERVIEW,
  MAX_EVENTS,
  type ColumnRank,
  type RankColumn,
  type SmbCompetitorRow,
  type SmbMarketChange,
  type SmbOverviewData,
} from "./types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const COHORT_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
const COHORT_CAP = 2000;
const MAX_SERVICE_EVENTS = 5;

export async function getSmbHomeData(userId: string): Promise<SmbOverviewData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-home-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_OVERVIEW;
  }
  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_OVERVIEW;
  }

  try {
    const business = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        city: true,
        province: true,
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
          select: {
            pillarScore: true,
            reputationPillar: true,
            visibilityPillar: true,
            profilePillar: true,
            websitePillar: true,
            adsPillar: true,
            adsApplicable: true,
            cellKey: true,
            snapshotDate: true,
          },
        },
      },
    });

    if (!business) return EMPTY_SMB_OVERVIEW;
    const snap = business.snapshots[0] ?? null;

    const now = new Date();
    const cutoff7d = new Date(now.getTime() - SEVEN_DAYS_MS);

    const unansweredReviewCount = await prisma.review.count({
      where: { businessId: business.id, ownerReplied: false },
    });

    const topFixes = deriveOverviewFixes({
      reputation: snap?.reputationPillar ?? null,
      visibility: snap?.visibilityPillar ?? null,
      profile: snap?.profilePillar ?? null,
      website: snap?.websitePillar ?? null,
      advertising: snap?.adsPillar ?? null,
      adsApplicable: snap?.adsApplicable ?? null,
      unansweredReviewCount,
    });

    const base: SmbOverviewData = {
      ...EMPTY_SMB_OVERVIEW,
      ownedBusinessId: business.id,
      slug: business.slug,
      name: business.name,
      category: business.category,
      city: business.city,
      province: business.province,
      mapslyScore: snap?.pillarScore ?? null,
      reputation: snap?.reputationPillar ?? null,
      visibility: snap?.visibilityPillar ?? null,
      profile: snap?.profilePillar ?? null,
      website: snap?.websitePillar ?? null,
      ads: snap?.adsPillar ?? null,
      adsApplicable: snap?.adsApplicable ?? null,
      lastSnapshotAt: snap?.snapshotDate ?? null,
      topFixes,
    };

    const cellKey = snap?.cellKey ?? null;
    if (!cellKey) {
      // Not graded into a market yet — show the hero + fixes, market fills in
      // after the next cell-aggregate + pillar-score pass.
      return base;
    }

    // Latest + prior weekly snapshot per business in the owner's market.
    const cohort = await prisma.businessSnapshot.findMany({
      where: {
        cellKey,
        snapshotDate: { gte: new Date(now.getTime() - COHORT_WINDOW_MS) },
      },
      orderBy: [{ businessId: "asc" }, { snapshotDate: "desc" }],
      take: COHORT_CAP,
      select: {
        businessId: true,
        snapshotDate: true,
        pillarScore: true,
        reputationPillar: true,
        visibilityPillar: true,
        profilePillar: true,
        websitePillar: true,
        adsPillar: true,
        adsApplicable: true,
        rating: true,
        reviewCount: true,
        photosCount: true,
        signalsJson: true,
        pillarRanks: true,
        business: { select: { name: true } },
      },
    });

    type Row = (typeof cohort)[number];
    interface Grouped {
      name: string;
      current: Row;
      prior: Row | null;
    }
    const byBiz = new Map<string, Grouped>();
    for (const row of cohort) {
      const g = byBiz.get(row.businessId);
      if (!g) {
        byBiz.set(row.businessId, {
          name: row.business.name,
          current: row,
          prior: null,
        });
      } else if (
        g.prior == null &&
        row.snapshotDate.getTime() !== g.current.snapshotDate.getTime()
      ) {
        g.prior = row;
      }
    }

    // Members of the cell (this + last week per business). We rank the WHOLE
    // cell server-side on EVERY column (master + each pillar), so the table's
    // "#" and "Δ" are authoritative across all pages for whichever column is
    // sorted. Null score → 0; standard competition ranking ("1 2 2 4"). The
    // delta diffs this week's live rank against last week's stored rank for the
    // same column (warms up as weekly history accrues).
    const members = [...byBiz.entries()].map(([id, g]) => ({
      id,
      name: g.name,
      isOwn: id === business.id,
      current: g.current,
      prior: g.prior,
    }));
    type Member = (typeof members)[number];

    const adsScoreOf = (m: Member): number =>
      m.current.adsApplicable === false ? 0 : (m.current.adsPillar ?? 0);
    const RANK_COLS: {
      col: RankColumn;
      score: (m: Member) => number;
      priorKey: string;
    }[] = [
      {
        col: "mapsly",
        score: (m) => m.current.pillarScore ?? 0,
        priorKey: "master",
      },
      {
        col: "reputation",
        score: (m) => m.current.reputationPillar ?? 0,
        priorKey: "reputation",
      },
      {
        col: "visibility",
        score: (m) => m.current.visibilityPillar ?? 0,
        priorKey: "visibility",
      },
      { col: "ads", score: adsScoreOf, priorKey: "advertising" },
      {
        col: "website",
        score: (m) => m.current.websitePillar ?? 0,
        priorKey: "website",
      },
      {
        col: "profile",
        score: (m) => m.current.profilePillar ?? 0,
        priorKey: "profile",
      },
    ];

    // Per-column current rank (competition ranking) over the full cell.
    const curRankByCol = new Map<RankColumn, Map<string, number>>();
    for (const { col, score } of RANK_COLS) {
      const sorted = members
        .map((m) => ({ id: m.id, v: score(m) }))
        .sort((a, b) => b.v - a.v);
      const map = new Map<string, number>();
      let prevV: number | null = null;
      let prevR = 0;
      sorted.forEach((e, i) => {
        const rank = prevV !== null && e.v === prevV ? prevR : i + 1;
        prevV = e.v;
        prevR = rank;
        map.set(e.id, rank);
      });
      curRankByCol.set(col, map);
    }

    const competitors: SmbCompetitorRow[] = members.map((m) => {
      const ranks = {} as Record<RankColumn, ColumnRank>;
      for (const { col, priorKey } of RANK_COLS) {
        const rank = curRankByCol.get(col)!.get(m.id)!;
        const prior = rankFromPillarRanks(m.prior?.pillarRanks, priorKey);
        ranks[col] = { rank, delta: prior != null ? prior - rank : null };
      }
      const adsApplicable = m.current.adsApplicable ?? null;
      return {
        id: m.id,
        name: m.name,
        isOwn: m.isOwn,
        mapslyScore: m.current.pillarScore ?? null,
        reputation: m.current.reputationPillar ?? null,
        visibility: m.current.visibilityPillar ?? null,
        profile: m.current.profilePillar ?? null,
        website: m.current.websitePillar ?? null,
        ads: adsApplicable === false ? 0 : (m.current.adsPillar ?? null),
        adsApplicable,
        ranks,
      };
    });

    const ownRow = competitors.find((c) => c.isOwn) ?? null;

    // Market events — diff this week vs last week per business.
    const weeks: BizWeek[] = members.map((m) => ({
      businessId: m.id,
      name: m.name,
      isOwn: m.isOwn,
      current: toSignals(m.current),
      prior: m.prior ? toSignals(m.prior) : null,
    }));
    const events: SmbMarketChange[] = deriveMarketChanges(weeks);

    // Owner service additions — owner-only (we don't detect competitor
    // services), so they ride alongside the snapshot-diff events.
    const newServices = await prisma.businessService.findMany({
      where: {
        businessId: business.id,
        isActive: true,
        createdAt: { gte: cutoff7d },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_SERVICE_EVENTS,
      select: { id: true, name: true, createdAt: true },
    });
    for (const s of newServices) {
      events.push({
        id: `services-${s.id}`,
        type: "services",
        businessId: business.id,
        businessName: business.name,
        isOwn: true,
        body: `You added a new service: ${s.name}.`,
        delta: "new",
        tone: "neutral",
        at: s.createdAt.toISOString(),
      });
    }

    return {
      ...base,
      rank: ownRow?.ranks.mapsly.rank ?? null,
      total: competitors.length || null,
      rankDelta: ownRow?.ranks.mapsly.delta ?? null,
      competitors,
      events: events.slice(0, MAX_EVENTS),
    };
  } catch {
    return EMPTY_SMB_OVERVIEW;
  }
}

/* ---------------------------------------------------------------- helpers */

/** Extract the diff-engine signal bundle from a snapshot row + its bag. */
function toSignals(row: {
  snapshotDate: Date;
  rating: number | null;
  reviewCount: number | null;
  photosCount: number | null;
  signalsJson: unknown;
}): SnapshotSignals {
  const j = asRecord(row.signalsJson);
  return {
    snapshotDate: row.snapshotDate,
    rating: row.rating,
    reviewCount: row.reviewCount,
    photosCount: row.photosCount,
    hasActiveGoogleAds: boolOrNull(j?.hasActiveGoogleAds),
    hasActiveMetaAds: boolOrNull(j?.hasActiveMetaAds),
    localPackRank: numOrNull(j?.localPackRank),
    organicRankBest: numOrNull(j?.organicRankBest),
    lighthousePerformance: numOrNull(j?.lighthousePerformance),
  };
}

/** Read a stored per-column rank (e.g. "master", "profile") from last week's
 * pillarRanks JSON — the prior-week baseline for that column's weekly delta. */
function rankFromPillarRanks(v: unknown, key: string): number | null {
  const o = asRecord(v);
  const e = asRecord(o?.[key]);
  const r = e?.rank;
  return typeof r === "number" && Number.isFinite(r) ? r : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
