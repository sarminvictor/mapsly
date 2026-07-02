"use server";

/**
 * polishTouchAction (WP5-6) · the gpt-5.4-nano fluency pass, finally invoked.
 *
 * nano-fill.ts (fluencyRewrite) was designed-but-uninvoked: it rewords a
 * grounded skeleton so it reads human, mechanically fact-checked so it can
 * NEVER add a claim, and falls back to the original on any failure. This
 * action wires it behind a per-draft "Polish" button in the Touchpoints tab.
 *
 * Cost plumbing: callOpenAi asserts an open CronRun (cost-counter context), so
 * the nano call runs inside withCronRun("ondemand:nano-polish") — user-billed
 * on-demand work, same pattern the cost rules allow for user-triggered
 * re-audits. The wallet bills 1 credit per polish (usdToCredits of the
 * NANO_PER_BUSINESS_USD blended rate), held before the call and refunded when
 * nano never billed (transport error / empty output).
 *
 * Email-channel only — phone scripts + DMs are intentionally terse and skip
 * nano (see modules/outreach/channels.ts).
 *
 * Auth + Zod + agency scope per `.claude/rules/security.md`; spend-gated to
 * OWNER/ADMIN per docs/seat-model.md.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import {
  ACTION_ENQUEUE_LIMIT,
  rateLimitAction,
} from "@/lib/middleware/rate-limit";
import { requireSpendMember } from "@/modules/agency-portal/roles";
import { usdToCredits } from "@/modules/cost/estimate";
import { NANO_PER_BUSINESS_USD } from "@/modules/cost/pricing";
import {
  grantFreeTierIfNew,
  holdCredits,
  refundHold,
  settleRun,
  WalletError,
} from "@/modules/cost/server";

import { fluencyRewrite, type FluencyResult } from "./nano-fill";
import { canAgencyMutateDraft } from "./draft-scope";
import type { FirstTouch } from "./first-touch";

/** Whole credits one polish bills (1 at current pricing — never 0). */
const POLISH_CREDITS = Math.max(1, usdToCredits(NANO_PER_BUSINESS_USD));

const PolishInput = z.object({
  draftId: z.string().min(1).max(64),
});

export type PolishTouchInput = z.input<typeof PolishInput>;

export type PolishTouchResult =
  | { status: "ok"; body: string; creditsCharged: number }
  | { status: "unchanged"; reason: string }
  | { status: "not_applicable" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "insufficient_credits"; creditsNeeded: number }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function polishTouchAction(
  input: unknown,
): Promise<PolishTouchResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · polish makes a billed AI call — bound it enqueue-class.
  const rl = await rateLimitAction(ACTION_ENQUEUE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  const parsed = PolishInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await requireSpendMember(session.user.id);
    if (!member) return { status: "forbidden" };
    const agencyId = member.agencyId;

    const draft = await prisma.outreachDraft.findUnique({
      where: { id: parsed.data.draftId },
      select: {
        id: true,
        agencyId: true,
        businessId: true,
        channel: true,
        subject: true,
        body: true,
      },
    });
    if (!draft) return { status: "forbidden" };
    const owns = await canAgencyMutateDraft(agencyId, draft);
    if (!owns) return { status: "forbidden" };

    // Nano polish is email-only (phone/social are intentionally terse).
    if (draft.channel !== "email") return { status: "not_applicable" };

    // The fact-check needs the business name (a rewrite must not drop it).
    const business = await prisma.business.findUnique({
      where: { id: draft.businessId },
      select: { name: true },
    });
    if (!business) return { status: "forbidden" };

    const runId = `polish:${randomUUID()}`;
    await grantFreeTierIfNew(agencyId);
    try {
      await holdCredits(agencyId, POLISH_CREDITS, runId);
    } catch (err) {
      if (err instanceof WalletError && err.code === "insufficient_credits") {
        return {
          status: "insufficient_credits",
          creditsNeeded: POLISH_CREDITS,
        };
      }
      throw err;
    }

    // The draft body IS the grounded skeleton (or a prior hand-edit of it) —
    // fluencyRewrite treats it as the ground truth its fact-check enforces.
    const skeleton: FirstTouch = {
      subject: draft.subject ?? undefined,
      body: draft.body,
      why: [],
      predictedTier: "low",
      usedSignals: [],
      droppedTokens: [],
    };

    let result: FluencyResult;
    try {
      result = await withCronRun("ondemand:nano-polish", () =>
        fluencyRewrite(skeleton, { businessName: business.name }),
      );
    } catch (err) {
      await refundHold(runId);
      throw err;
    }

    if (!result.rewritten) {
      // Fallback → the draft is untouched. Refund unless nano actually billed
      // (a rejected-but-paid call is our cost to absorb only when free).
      if (result.costUsd > 0) {
        await settleRun(runId, POLISH_CREDITS);
        return {
          status: "unchanged",
          reason: result.fallbackReason ?? "rejected",
        };
      }
      await refundHold(runId);
      return {
        status: "unchanged",
        reason: result.fallbackReason ?? "rejected",
      };
    }

    await prisma.outreachDraft.update({
      where: { id: draft.id },
      data: { body: result.body },
      select: { id: true },
    });
    const settled = await settleRun(runId, POLISH_CREDITS);

    return {
      status: "ok",
      body: result.body,
      creditsCharged: settled.charged,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "touchpoints.polish.error",
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
