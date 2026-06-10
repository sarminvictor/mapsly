// Monthly · email-verification
//
// Revalidate persisted SMB owner email addresses. Mailboxes change slowly
// (a few percent per quarter), so a monthly SMTP probe is the right
// cadence. Each `Business.email` whose `emailVerifiedAt` is null or stale
// gets an `smtpVerifyEmail` probe; on `undeliverable` we clear the email
// + verification timestamp so onboarding flows refuse to reuse the dead
// address. `deliverable` and `inconclusive` results refresh
// `emailVerifiedAt` so the row drops out of the queue for the next month.
//
// Source: `services/email-verify/smtp` ($0/probe but cost-counter-tracked
// so the "no live API in user request path" invariant + per-CronRun probe
// telemetry both hold).
//
// Cadence: monthly day-1 11:00 UTC per `vercel.json`. Default 200
// addresses per run (the SMTP probe is the slowest external operation we
// run — each can take up to 20s on a flaky MX; 200 × 5s avg ≈ 17min — we
// trade throughput for kindness to remote MX rate limits).

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { suppress } from "@/modules/cold/suppression";
import { smtpVerifyEmail } from "@/services/email-verify";
import {
  resolveBatchLimit,
  runBatch,
  statusFromOutcome,
} from "../../_lib/batch";

const JOB = "monthly:email-verification";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
/** Skip rows verified within this window — monthly cadence is the design. */
const VERIFY_FRESH_MS = 30 * 24 * 60 * 60 * 1000;

interface BusinessEmailRow {
  id: string;
  slug: string;
  email: string;
}

export const GET = cronHandler(JOB, async (ctx) => {
  return await processMonthlyEmailVerification(undefined, ctx);
});

/**
 * Implementation entrypoint. Extracted so unit tests can invoke it
 * directly with a synthetic Request, bypassing the cron-secret + ALS
 * plumbing in `cronHandler`.
 */
export async function processMonthlyEmailVerification(
  req: Request | undefined,
  ctx: { runId: string; job: string },
) {
  const limit = req
    ? resolveBatchLimit(req, DEFAULT_LIMIT, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const cutoff = new Date(Date.now() - VERIFY_FRESH_MS);

  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      email: { not: null },
      OR: [{ emailVerifiedAt: null }, { emailVerifiedAt: { lt: cutoff } }],
    },
    select: { id: true, slug: true, email: true },
    take: limit,
    orderBy: [
      { emailVerifiedAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ],
  });

  const rows: BusinessEmailRow[] = candidates
    .filter(
      (c): c is { id: string; slug: string; email: string } =>
        typeof c.email === "string" && c.email.length > 0,
    )
    .map((c) => ({ id: c.id, slug: c.slug, email: c.email }));

  let deliverable = 0;
  let undeliverable = 0;
  let inconclusive = 0;
  let clearedEmails = 0;
  let coldStopped = 0;
  const revalidatedSlugs = new Set<string>();

  const outcome = await runBatch(rows, async (biz: BusinessEmailRow) => {
    const result = await smtpVerifyEmail({ email: biz.email });
    const now = new Date();

    if (result.verdict === "undeliverable") {
      undeliverable += 1;
      // Clear the dead address so onboarding / cohort flows can't reuse
      // it. We retain the verification timestamp pointing at the moment
      // we proved it dead so we don't immediately re-probe the same
      // record next month.
      await prisma.business.update({
        where: { id: biz.id },
        data: { email: null, emailVerifiedAt: now },
      });
      clearedEmails += 1;
      // Feed the verdict into the cold-email pipeline: suppress globally and
      // stop any in-flight sequence — a proven-dead address must never get
      // touch 2-3 (audit 2026-06-09 finding 3).
      await suppress(biz.email, "UNDELIVERABLE", "monthly smtp probe");
      const stopped = await prisma.coldRecipient.updateMany({
        where: {
          email: biz.email.toLowerCase(),
          status: { in: ["PENDING", "ACTIVE"] },
        },
        data: {
          status: "BOUNCED",
          stopReason: "email undeliverable (monthly probe)",
          nextRunAt: null,
        },
      });
      if (stopped.count > 0) coldStopped += stopped.count;
    } else {
      if (result.verdict === "deliverable") deliverable += 1;
      else inconclusive += 1;
      await prisma.business.update({
        where: { id: biz.id },
        data: { emailVerifiedAt: now },
      });
    }
    revalidatedSlugs.add(biz.slug);
  });

  for (const slug of revalidatedSlugs) {
    revalidateTag(`business-${slug}`, "weeks");
  }

  return {
    itemsProcessed: outcome.succeeded,
    status: statusFromOutcome(outcome),
    meta: {
      runId: ctx.runId,
      limit,
      attempted: outcome.attempted,
      succeeded: outcome.succeeded,
      failed: outcome.failures.length,
      deliverable,
      undeliverable,
      inconclusive,
      clearedEmails,
      coldStopped,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        businessId: (f.item as BusinessEmailRow).id,
        error: f.error,
      })),
    },
  };
}

export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  VERIFY_FRESH_MS,
  processMonthlyEmailVerification,
};
