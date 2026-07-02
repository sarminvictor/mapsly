// modules/agency-portal/notify/market-digest.ts · WP6-2 · the weekly
// "your market moved" digest. For each agency with ≥1 ACTIVE research, diff the
// past week's refreshed data WITHIN that research's cells against three
// change classes and send ONE Resend email deep-linked to the workbench:
//
//   • new matching businesses  — Business.createdAt in the cell this week
//   • new 1–2★ reviews         — Review.postedAt this week on cell businesses
//   • competitor ads appearing — AdLibraryEntry.firstSeenAt (META) this week
//
// SUPPRESSED when nothing changed for an agency (no empty emails). The three
// diffs read only tables the weekly crons already write (BusinessSnapshot via
// discovery, Review via reviews-delta, AdLibraryEntry via ads-meta) — no
// external API, bounded per agency, cost-tracked by the wrapping cronHandler.
//
// Best-effort: any per-agency error is logged + skipped, never throws.

import prisma from "@/lib/prisma";
import { absoluteUrl } from "@/lib/seo/canonical";
import { sendAgencyDigest, type DigestChange } from "./email";
import { resolveAgencyRecipient } from "./run-finished";

/** The diff window — one week (the weekly-cron cadence this digest reports on). */
const WINDOW_DAYS = 7;
/** Cap agencies processed per tick so a large tenant base stays bounded. */
const MAX_AGENCIES = 500;
/** Cap the cell businesses scanned per research (scale guard). */
const MAX_CELL_BUSINESSES = 5000;

export interface DigestSweepResult {
  agenciesScanned: number;
  sent: number;
  suppressedEmpty: number;
  skippedNoRecipient: number;
}

/**
 * Sweep all agencies with active researches and email a weekly digest to each
 * one that has ≥1 change. Idempotent-enough by cadence (the weekly schedule
 * runs it once); a manual re-trigger the same week re-sends (acceptable for a
 * digest — no money side effect).
 */
export async function sweepMarketDigests(
  now: Date = new Date(),
): Promise<DigestSweepResult> {
  const result: DigestSweepResult = {
    agenciesScanned: 0,
    sent: 0,
    suppressedEmpty: 0,
    skippedNoRecipient: 0,
  };
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  // Agencies that own ≥1 ACTIVE research — the only ones with a market to move.
  // No Agency→Discovery back-relation exists, so distinct-groupBy Discovery.
  const activeAgencies = await prisma.discovery.groupBy({
    by: ["agencyId"],
    where: { researchStatus: "ACTIVE" },
    orderBy: { agencyId: "asc" },
    take: MAX_AGENCIES,
  });

  for (const { agencyId } of activeAgencies) {
    result.agenciesScanned += 1;
    try {
      const changes = await buildAgencyChanges(agencyId, since);
      if (changes.length === 0) {
        result.suppressedEmpty += 1;
        continue;
      }
      const recipient = await resolveAgencyRecipient(agencyId);
      if (!recipient) {
        result.skippedNoRecipient += 1;
        continue;
      }
      const ok = await sendAgencyDigest({
        to: recipient.email,
        agencyName: recipient.agencyName,
        changes,
        researchUrl: absoluteUrl("/research"),
      });
      if (ok) result.sent += 1;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "market-digest.agency.failed",
          agencyId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return result;
}

/**
 * Build the week's changes for one agency, one deep-linked line per ACTIVE
 * research that moved. Returns [] when nothing changed (caller suppresses).
 */
async function buildAgencyChanges(
  agencyId: string,
  since: Date,
): Promise<DigestChange[]> {
  const researches = await prisma.discovery.findMany({
    where: { agencyId, researchStatus: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, name: true, cellKeys: true },
  });

  const changes: DigestChange[] = [];
  for (const r of researches) {
    if (r.cellKeys.length === 0) continue;

    // The cell businesses this research covers (bounded). All three diffs
    // filter to these ids so the digest is research-scoped, not global.
    const cellBusinesses = await prisma.business.findMany({
      where: { cellKey: { in: r.cellKeys } },
      select: { id: true },
      take: MAX_CELL_BUSINESSES,
    });
    const bizIds = cellBusinesses.map((b) => b.id);
    if (bizIds.length === 0) continue;

    // 1 · New matching businesses in the cell this week.
    const newBiz = await prisma.business.count({
      where: { cellKey: { in: r.cellKeys }, createdAt: { gte: since } },
    });

    // 2 · New 1–2★ reviews on cell businesses this week.
    const newNegatives = await prisma.review.count({
      where: {
        businessId: { in: bizIds },
        stars: { lte: 2 },
        postedAt: { gte: since },
      },
    });

    // 3 · Competitor Meta ads that first appeared this week.
    const newAds = await prisma.adLibraryEntry.count({
      where: {
        businessId: { in: bizIds },
        platform: "META",
        firstSeenAt: { gte: since },
      },
    });

    const parts: string[] = [];
    if (newBiz > 0)
      parts.push(`${newBiz} new match${newBiz === 1 ? "" : "es"}`);
    if (newNegatives > 0)
      parts.push(
        `${newNegatives} new 1–2★ review${newNegatives === 1 ? "" : "s"}`,
      );
    if (newAds > 0)
      parts.push(`${newAds} competitor ad${newAds === 1 ? "" : "s"} started`);
    if (parts.length === 0) continue;

    const label = `${r.name ?? "Your research"} — ${parts.join(" · ")}`;
    changes.push({ label, url: absoluteUrl(`/discover/${r.id}`) });
  }

  return changes;
}
