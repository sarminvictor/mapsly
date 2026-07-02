"use server";

/**
 * WP6-13 · bad-data feedback loop.
 *
 * `reportWrongDataAction` lets a teammate flag a specific datum on a lead as
 * wrong (a wrong number / a changed site / a closed business) from the drawer.
 * It:
 *   1. marks the datum disputed + hides it from artifacts WITHOUT a migration —
 *      a contact-value dispute opts the matching `Contact` out (`optedOutAt`,
 *      which WP0-7/WP7-2 already excludes from CSV / touch-gen / one-pagers);
 *   2. AUTO-REFUNDS the family credit via the ledger rails (`refundCredits` →
 *      a REFUND row + wallet credit, idempotent per disputed key);
 *   3. accrues a per-source quality signal as a `data_disputed` ProductEvent
 *      (WP6-4 rails) so the dashboard can trend scraper accuracy by source.
 *
 * Auth-gated + Zod-validated. Agency-scoped: the business must live in one of
 * the caller's discovered cells (cross-agency / missing → not_found — we never
 * confirm another agency's data). Reporting is a STAFF-allowed action (it's not
 * a spend — the refund is an automatic make-good, not discretionary).
 * No external API (DB-only).
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  ACTION_MUTATE_LIMIT,
  rateLimitAction,
} from "@/lib/middleware/rate-limit";
import { callerAgencyMember } from "@/modules/agency-portal/roles";
import { refundCredits } from "@/modules/cost/server";
import { usdToCredits } from "@/modules/cost/estimate";
import { ENRICHMENT_PRICES, type EnrichmentType } from "@/modules/cost/pricing";
import { trackProductEvent } from "@/lib/analytics/product-events";

/**
 * What kind of datum is being disputed (drives the hide + which family refunds).
 * WP7-3 adds `wrong_finding` — a dispute on a PLAYBOOK FINDING (an expert flag),
 * not on contact data: it hides the finding from every shared artifact
 * (one-pager / share page / CSV / workbench chips all read `status:"flagged"`)
 * and records a per-source quality signal, but does NOT refund a data family
 * (findings aren't independently billed — a make-good refund would be wrong).
 */
const DisputeReason = z.enum([
  "wrong_number",
  "wrong_email",
  "site_changed",
  "closed",
  "wrong_finding",
]);
type DisputeReason = z.infer<typeof DisputeReason>;

const Input = z.object({
  businessId: z.string().min(1).max(64),
  reason: DisputeReason,
  /** The exact contact value being disputed (phone/email) — required for the
   *  number/email reasons so we opt out the right Contact row. */
  value: z.string().min(1).max(256).optional(),
  /** The disputed finding's `PlaybookFinding.signalKey` — required for the
   *  `wrong_finding` reason so we flag the right finding row. */
  signalKey: z.string().min(1).max(128).optional(),
});

export type ReportWrongDataResult =
  | { status: "ok"; refunded: number }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "not_found" }
  | { status: "invalid_input"; message?: string }
  | { status: "error" };

/**
 * Map a dispute reason → the enrichment family whose credit we refund. Only the
 * DATA reasons refund (the datum was paid for and is wrong). `wrong_finding` is
 * absent: a playbook finding isn't independently billed, so it's hidden but not
 * refunded (see the branch in the action body).
 */
const REASON_FAMILY: Record<
  Exclude<DisputeReason, "wrong_finding">,
  EnrichmentType
> = {
  wrong_number: "contacts",
  wrong_email: "contacts",
  site_changed: "tech",
  closed: "reviews", // the closed/open status rides the reviews/profile pull
};

export async function reportWrongDataAction(
  input: unknown,
): Promise<ReportWrongDataResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · bound dispute floods (auto-refunds credits — abuse-adjacent).
  const rl = await rateLimitAction(ACTION_MUTATE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message,
    };
  }
  const { businessId, reason, value, signalKey } = parsed.data;

  try {
    const member = await callerAgencyMember(session.user.id);
    if (!member) return { status: "forbidden" };
    const agencyId = member.agencyId;

    // Agency-scope gate (same universe as getLeadDetail): the business must be
    // in one of this agency's discovered cells.
    const discoveries = await prisma.discovery.findMany({
      where: { agencyId },
      select: { cellKeys: true },
    });
    const cellKeys = new Set(discoveries.flatMap((d) => d.cellKeys));
    if (cellKeys.size === 0) return { status: "not_found" };

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, cellKey: true },
    });
    if (!business || !business.cellKey || !cellKeys.has(business.cellKey)) {
      return { status: "not_found" };
    }

    // WP7-3 · a disputed PLAYBOOK FINDING (an expert flag), not contact data.
    // Flip the finding out of `flagged` → `disputed` so it disappears from
    // EVERY shared artifact (the drawer, the one-pager, /s/[token], the CSV, the
    // workbench chips — all read `status:"flagged"`), and stamp `feedback` for
    // the per-source quality dashboard. No family refund (findings aren't
    // independently billed). Idempotent: updateMany over the flagged row only.
    if (reason === "wrong_finding") {
      if (!signalKey) {
        return { status: "invalid_input", message: "signalKey required" };
      }
      const upd = await prisma.playbookFinding.updateMany({
        where: { businessId, signalKey, status: "flagged" },
        data: { status: "disputed", feedback: "disputed" },
      });
      void trackProductEvent({
        type: "finding_disputed",
        agencyId,
        userId: session.user.id,
        props: { businessId, signalKey, hidFinding: upd.count > 0 },
      });
      return { status: "ok", refunded: 0 };
    }

    // 1 · Hide the datum. A contact-value dispute opts the matching Contact out
    //     (excluded from artifacts per WP0-7). Site/closed disputes have no
    //     per-field hide without a migration — the refund + quality signal are
    //     the remediation; we deliberately do NOT suppress the whole business
    //     (too destructive) here.
    let hiddenContactId: string | null = null;
    if ((reason === "wrong_number" || reason === "wrong_email") && value) {
      const channels =
        reason === "wrong_number"
          ? (["PHONE", "WHATSAPP"] as const)
          : (["EMAIL"] as const);
      const contact = await prisma.contact.findFirst({
        where: {
          businessId,
          channel: { in: [...channels] },
          value,
          optedOutAt: null,
        },
        select: { id: true },
      });
      if (contact) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { optedOutAt: new Date() },
          select: { id: true },
        });
        hiddenContactId = contact.id;
      }
    }

    // 2 · Auto-refund the family credit (idempotent per business+reason+value).
    const family = REASON_FAMILY[reason];
    const familyCredits = usdToCredits(ENRICHMENT_PRICES[family].usdPerUnit);
    const dedupeKey = `${businessId}:${reason}:${value ?? ""}`;
    const { refunded } = await refundCredits(
      agencyId,
      familyCredits,
      `bad-data dispute (${reason})`,
      dedupeKey,
    );

    // 3 · Per-source quality signal (no PII — the disputed value is NOT stored).
    void trackProductEvent({
      type: "data_disputed",
      agencyId,
      userId: session.user.id,
      props: {
        businessId,
        reason,
        family,
        refunded,
        hidContact: hiddenContactId != null,
      },
    });

    return { status: "ok", refunded };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "dispute.report.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
