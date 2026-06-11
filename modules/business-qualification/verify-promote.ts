/**
 * Verify-and-promote · the missing bridge between qualification and
 * cold outreach.
 *
 * Qualification writes `emailDiscovered` (scrape/RDAP/AI find). The
 * cold-email enroll gate (modules/cold/enroll.ts) requires
 * `Business.email` + `emailVerifiedAt` — columns NOTHING set until
 * this module existed (2026-06-11 audit: 205 QUALIFIED businesses,
 * zero enrollable, zero ColdRecipients ever).
 *
 * For each QUALIFIED cell member with a discovered-but-unpromoted
 * email, run the free SMTP probe (services/email-verify):
 *   - deliverable / inconclusive → promote: `email` + `emailVerifiedAt`
 *     (same semantics as the monthly email-verification cron, which
 *     then maintains the rows on its own cadence)
 *   - undeliverable → flag "email_undeliverable", do NOT promote —
 *     hard bounces burn the 750/wk sender budget and the domain's
 *     reputation, which is the whole point of probing first.
 *
 * Batched: SMTP probes take 2-20s each on slow MX hosts, so one call
 * processes ≤ `limit` rows (default 60 · ~1-2 min at concurrency 4,
 * inside Vercel's 300s action budget) and reports how many remain.
 * The admin clicks again until remaining hits 0 — explicit control,
 * no hidden background spend of sender-reputation risk.
 *
 * Idempotent: promoted rows drop out of the WHERE (email no longer
 * null); undeliverable rows keep emailDiscovered for the audit trail
 * but are excluded by the flag check, so re-clicks never re-probe them.
 */

import prisma from "@/lib/prisma";
import { smtpVerifyEmail } from "@/services/email-verify";

import { cellMembershipWhere } from "@/modules/business-discovery";

const DEFAULT_BATCH_LIMIT = 60;
const VERIFY_CONCURRENCY = 4;

export interface VerifyPromoteResult {
  /** Rows probed this batch. */
  processed: number;
  /** Promoted with verdict "deliverable". */
  promotedDeliverable: number;
  /** Promoted with verdict "inconclusive" (greylisting etc. — the
   *  monthly cron treats these as keep; so do we). */
  promotedInconclusive: number;
  /** Flagged email_undeliverable, not promoted. */
  undeliverable: number;
  /** Probe threw (DNS/socket error) — left untouched, retryable. */
  errors: number;
  /** Eligible rows still waiting after this batch. */
  remaining: number;
}

export async function verifyAndPromoteCellEmails(input: {
  trackedLocationId: string;
  limit?: number;
}): Promise<VerifyPromoteResult> {
  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_BATCH_LIMIT), 200);

  const cell = await prisma.trackedLocation.findUnique({
    where: { id: input.trackedLocationId },
    select: {
      id: true,
      city: true,
      country: true,
      lat: true,
      lng: true,
      radiusKm: true,
      category: { select: { dataforseoId: true } },
    },
  });
  if (!cell) {
    throw new Error(`TrackedLocation ${input.trackedLocationId} not found`);
  }

  const eligibleWhere = {
    ...cellMembershipWhere({
      dataforseoCategoryId: cell.category.dataforseoId,
      lat: cell.lat,
      lng: cell.lng,
      radiusKm: cell.radiusKm,
      city: cell.city,
      country: cell.country,
    }),
    qualificationStatus: "QUALIFIED" as const,
    emailDiscovered: { not: null },
    email: null,
    NOT: { qualificationFlags: { has: "email_undeliverable" } },
  };

  const batch = await prisma.business.findMany({
    where: eligibleWhere,
    select: { id: true, emailDiscovered: true, qualificationFlags: true },
    take: limit,
    orderBy: { qualifiedAt: "asc" },
  });

  let promotedDeliverable = 0;
  let promotedInconclusive = 0;
  let undeliverable = 0;
  let errors = 0;

  // Hand-rolled worker pool (same pattern as qualifyCell) — polite to
  // remote MX hosts, bounded wall-clock.
  const queue = [...batch];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const biz = queue.shift();
      if (!biz?.emailDiscovered) continue;
      try {
        const result = await smtpVerifyEmail({ email: biz.emailDiscovered });
        if (result.verdict === "undeliverable") {
          undeliverable += 1;
          await prisma.business.update({
            where: { id: biz.id },
            data: {
              qualificationFlags: Array.from(
                new Set([...biz.qualificationFlags, "email_undeliverable"]),
              ),
            },
          });
        } else {
          if (result.verdict === "deliverable") promotedDeliverable += 1;
          else promotedInconclusive += 1;
          await prisma.business.update({
            where: { id: biz.id },
            data: {
              email: biz.emailDiscovered,
              emailVerifiedAt: new Date(),
            },
          });
        }
      } catch {
        // DNS/socket blow-up — leave the row eligible for a re-click.
        errors += 1;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(VERIFY_CONCURRENCY, batch.length) }, () =>
      worker(),
    ),
  );

  const remaining = await prisma.business.count({ where: eligibleWhere });

  return {
    processed: batch.length,
    promotedDeliverable,
    promotedInconclusive,
    undeliverable,
    errors,
    remaining,
  };
}
