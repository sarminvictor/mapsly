// modules/agency-portal/notify/market-monitor.ts · WP6-12 · "why now" timing
// triggers. A weekly, plan-gated ($99+ · GROWTH/AGENCY_PRO/BOUTIQUE) monitor
// over each active research's cells that surfaces local-intent timing signals:
//
//   • competitor_started_ads — an AdLibraryEntry (META) first appeared in the
//     cell this week (ad_market_prevalence / ads_age_days moved)
//   • dropped_out_of_pack     — a cell business that had a local-3-pack rank
//     recently now has none in its latest SERP scan (rank_drop_last_30d)
//
// COST DISCIPLINE (.claude/rules/cost-discipline.md): this monitor makes NO new
// external DfS/Apify calls — it reads ONLY the data the weekly crons already
// refreshed (AdLibraryEntry, SerpResult), so there is nothing to cost-cap and no
// live API in a cron path that could blow a budget. (A future variant that
// re-scans cells LIVE on the DfS Standard queue would gate + cost-cap here; the
// $99+ plan gate is already in place for that upgrade.)
//
// Output: each signal is persisted as a lightweight `market_signal` ProductEvent
// (the workbench feed reads recent ones — no schema migration) AND returned so
// the WP6-2 digest can include timing lines for gated plans. Best-effort.

import prisma from "@/lib/prisma";
import { trackProductEvent } from "@/lib/analytics/product-events";
import type { AgencyPlanTier } from "@/modules/cost/pricing";

/** The Agency.plan enum values (structurally the AgencyPlanTier union). */
type AgencyPlan = AgencyPlanTier;

/** Plans that get the timing monitor ($99+ · everything except SOLO). */
const MONITOR_PLANS: AgencyPlan[] = ["GROWTH", "AGENCY_PRO", "BOUTIQUE"];

const WINDOW_DAYS = 7;
const MAX_AGENCIES = 500;
const MAX_CELL_BUSINESSES = 5000;

/** One surfaced timing signal for a research. */
export interface MarketTimingSignal {
  discoveryId: string;
  researchName: string | null;
  kind: "competitor_started_ads" | "dropped_out_of_pack";
  /** Human, agency-voice one-liner. */
  label: string;
  count: number;
}

export interface MarketMonitorResult {
  agenciesScanned: number;
  gatedOut: number;
  signalsFound: number;
}

/** Is this plan entitled to the timing monitor? */
export function planHasMarketMonitor(plan: AgencyPlan): boolean {
  return MONITOR_PLANS.includes(plan);
}

/**
 * Sweep gated agencies' active researches and persist any timing signals as
 * `market_signal` ProductEvents (the workbench feed source). Returns counts.
 */
export async function sweepMarketMonitor(
  now: Date = new Date(),
): Promise<MarketMonitorResult> {
  const result: MarketMonitorResult = {
    agenciesScanned: 0,
    gatedOut: 0,
    signalsFound: 0,
  };
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const activeAgencies = await prisma.discovery.groupBy({
    by: ["agencyId"],
    where: { researchStatus: "ACTIVE" },
    orderBy: { agencyId: "asc" },
    take: MAX_AGENCIES,
  });

  for (const { agencyId } of activeAgencies) {
    result.agenciesScanned += 1;
    try {
      const agency = await prisma.agency.findUnique({
        where: { id: agencyId },
        select: { plan: true },
      });
      if (!agency || !planHasMarketMonitor(agency.plan)) {
        result.gatedOut += 1;
        continue;
      }

      const signals = await detectTimingSignals(agencyId, since);
      for (const sig of signals) {
        // Persist as a feed row (workbench reads recent market_signal events).
        void trackProductEvent({
          type: "market_signal",
          agencyId,
          props: {
            discoveryId: sig.discoveryId,
            kind: sig.kind,
            count: sig.count,
            label: sig.label,
          },
        });
        result.signalsFound += 1;
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "market-monitor.agency.failed",
          agencyId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return result;
}

/**
 * Detect this week's timing signals for an agency (shared by the cron sweep +
 * the workbench-feed reader). Reads only already-refreshed data — no external
 * API. Returns [] when nothing moved.
 */
export async function detectTimingSignals(
  agencyId: string,
  since: Date,
): Promise<MarketTimingSignal[]> {
  const researches = await prisma.discovery.findMany({
    where: { agencyId, researchStatus: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, name: true, cellKeys: true },
  });

  const out: MarketTimingSignal[] = [];
  for (const r of researches) {
    if (r.cellKeys.length === 0) continue;
    const cellBusinesses = await prisma.business.findMany({
      where: { cellKey: { in: r.cellKeys } },
      select: { id: true },
      take: MAX_CELL_BUSINESSES,
    });
    const bizIds = cellBusinesses.map((b) => b.id);
    if (bizIds.length === 0) continue;

    // Signal 1 · competitors that STARTED advertising this week (distinct biz).
    const adStarts = await prisma.adLibraryEntry.groupBy({
      by: ["businessId"],
      where: {
        businessId: { in: bizIds },
        platform: "META",
        firstSeenAt: { gte: since },
      },
    });
    if (adStarts.length > 0) {
      out.push({
        discoveryId: r.id,
        researchName: r.name,
        kind: "competitor_started_ads",
        count: adStarts.length,
        label: `${adStarts.length} competitor${adStarts.length === 1 ? "" : "s"} started running Meta ads this week`,
      });
    }

    // Signal 2 · cell businesses that dropped OUT of the local 3-pack: their
    // latest SERP scan has no localPackRank, but a scan within the window did.
    const dropped = await countDroppedFromPack(bizIds, since);
    if (dropped > 0) {
      out.push({
        discoveryId: r.id,
        researchName: r.name,
        kind: "dropped_out_of_pack",
        count: dropped,
        label: `${dropped} business${dropped === 1 ? "" : "es"} dropped out of the local 3-pack this week`,
      });
    }
  }
  return out;
}

/**
 * Count cell businesses whose local-3-pack presence disappeared this week: a
 * SERP scan in the window had a localPackRank, but the latest scan has none.
 * Bounded per business (two findFirst reads); the cell business set is capped.
 */
async function countDroppedFromPack(
  bizIds: string[],
  since: Date,
): Promise<number> {
  let dropped = 0;
  // Cap the per-business SERP checks to keep the tick bounded on huge cells.
  const CHECK_CAP = 500;
  for (const businessId of bizIds.slice(0, CHECK_CAP)) {
    const latest = await prisma.serpResult.findFirst({
      where: { businessId },
      orderBy: { scannedAt: "desc" },
      select: { localPackRank: true, scannedAt: true },
    });
    if (!latest || latest.localPackRank != null) continue; // still in the pack
    // Was it in the pack within the window (before it dropped)?
    const prior = await prisma.serpResult.findFirst({
      where: {
        businessId,
        localPackRank: { not: null },
        scannedAt: { gte: since },
      },
      select: { id: true },
    });
    if (prior) dropped += 1;
  }
  return dropped;
}
