/**
 * Weekly Quick-Win assignment layer · S.6.5 (2026-05-28).
 *
 * Maria sees up to 3 quick-win cards per week. The set is fresh
 * every Monday (UTC): if she didn't act last week, NEXT week brings
 * different keywords thanks to a 4-week rolling exclusion. The same
 * keyword won't repeat for 4 weeks so suggestions stay fresh.
 *
 * Flow on every /search render:
 *   1. Compute `weekStart` = Monday 00:00 UTC of today
 *   2. Load this week's assignments for the biz (up to 3)
 *   3. If < 3 exist, top up from `pickQuickWinCandidates(keywords)`
 *      excluding any keywords assigned in the last 4 weeks
 *   4. Return the enriched list ready for the right-rail card
 */

import prisma from "@/lib/prisma";

import type { KeywordRow, SearchQuickWin } from "./types";
import { pickQuickWinCandidates } from "./types";

const TARGET_PER_WEEK = 3;
/** Rolling window: don't re-suggest the same keyword for this many
 *  weeks. 4 ≈ a month of distinct suggestions before recycling. */
const EXCLUSION_WEEKS = 4;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Monday 00:00 UTC of the week containing `now`. */
export function startOfWeekUtc(now: Date = new Date()): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dow = d.getUTCDay(); // 0 = Sun … 6 = Sat
  // Roll back to Monday · Sunday counts as the prior week's Monday.
  const offset = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

export interface GetWeeklyQuickWinsInput {
  businessId: string;
  /** All of Maria's KeywordRow records · the candidate pool. */
  rows: readonly KeywordRow[];
  /** Optional override · defaults to this Monday. */
  now?: Date;
}

export async function getWeeklyQuickWins(
  input: GetWeeklyQuickWinsInput,
): Promise<SearchQuickWin[]> {
  const weekStart = startOfWeekUtc(input.now);

  // 1. Load this week's existing assignments.
  const existing = await prisma.quickWinAssignment.findMany({
    where: { businessId: input.businessId, weekStart },
    orderBy: { estCustomers: "desc" },
    select: {
      keywordId: true,
      surface: true,
      estCustomers: true,
      keyword: { select: { id: true, keyword: true } },
    },
  });

  // Resolve existing assignments to candidate shape by re-deriving
  // from the current row data · keeps stateParams/actionKey fresh
  // if rank moved within the week.
  const candidatesAll = pickQuickWinCandidates(input.rows);
  const candidatesByKw = new Map(candidatesAll.map((c) => [c.id, c]));

  const resolved: SearchQuickWin[] = [];
  for (const a of existing) {
    const c = candidatesByKw.get(a.keywordId);
    if (c) {
      resolved.push(c);
    } else {
      // The keyword is no longer a quick-win candidate (she ranked up,
      // dropped, or volume changed). Still surface it with frozen
      // snapshot data so the card stays consistent for the week.
      resolved.push({
        id: a.keywordId,
        keyword: a.keyword?.keyword ?? "—",
        surface: a.surface === "maps" ? "maps" : "search",
        stateKey: a.surface === "maps" ? "maps_fringe" : "search_fringe",
        stateParams: {},
        actionKey: a.surface === "maps" ? "maps_signals" : "review_request",
        estCustomersPerMo: a.estCustomers,
      });
    }
  }

  if (resolved.length >= TARGET_PER_WEEK) return resolved;

  // 2. Top up · find candidates not in existing AND not in the
  //    rolling exclusion window.
  const exclusionCutoff = new Date(
    weekStart.getTime() - EXCLUSION_WEEKS * MS_PER_WEEK,
  );
  const recentlyAssigned = await prisma.quickWinAssignment.findMany({
    where: {
      businessId: input.businessId,
      weekStart: { gte: exclusionCutoff },
    },
    select: { keywordId: true },
  });
  const excludedKeywordIds = new Set(recentlyAssigned.map((r) => r.keywordId));
  // Existing this-week assignments are already in the excluded set
  // since they're within the window · belt-and-suspenders below.
  for (const a of existing) excludedKeywordIds.add(a.keywordId);

  const needed = TARGET_PER_WEEK - resolved.length;
  const toAssign = candidatesAll
    .filter((c) => !excludedKeywordIds.has(c.id))
    .slice(0, needed);

  if (toAssign.length === 0) return resolved;

  // 3. Persist + return. Use createMany with skipDuplicates so a race
  //    between two render paths can't double-assign the same row.
  await prisma.quickWinAssignment.createMany({
    data: toAssign.map((c) => ({
      businessId: input.businessId,
      keywordId: c.id,
      weekStart,
      surface: c.surface,
      estCustomers: c.estCustomersPerMo,
    })),
    skipDuplicates: true,
  });

  resolved.push(...toAssign);
  return resolved;
}
