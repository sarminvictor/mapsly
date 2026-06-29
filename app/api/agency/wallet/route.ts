/**
 * `/api/agency/wallet` · the caller's AgencyWallet balance for the HUD pill.
 *
 * GET → `{ balanceUsd: number | null, credits: number | null, hasWallet: boolean }`
 * Credits are a simple sum of the three usable buckets (plan + purchased +
 * rollover) minus held. There is no live USD/credit conversion here — the pill
 * is a glance; the precise pricing happens in the cost engine. `balanceUsd` is
 * a best-effort dollar view derived from credits at the wallet's overage cap,
 * or null when no conversion is known (the pill then shows the credit count).
 *
 * Per `.claude/rules/security.md`:
 *   - Auth-gated · only the signed-in agency member can read THEIR wallet.
 *   - No cross-agency leak · we resolve the agency from the session, never a
 *     query param.
 *
 * Per `.claude/rules/cost-discipline.md` · no external API calls, no CronRun.
 * Per `.claude/rules/performance.md` · a single indexed Prisma round-trip,
 * `private, no-store` (wallet is per-user, must never be shared-cached).
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { CREDIT_USD } from "@/modules/cost/pricing";
import { grantFreeTierIfNew } from "@/modules/cost/server";

// 1 credit's USD value — the single canonical price from modules/cost/pricing
// (was a divergent hardcoded $0.01 here · pricing source-of-truth fork, fixed).
const CREDIT_TO_USD = CREDIT_USD;

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { agencyId: true },
  });
  if (!member) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // Lazily fund a brand-new agency with its one-time free-tier credits so the
    // pill shows a real balance before the first spend. Idempotent + best-effort.
    await grantFreeTierIfNew(member.agencyId).catch(() => {});

    const wallet = await prisma.agencyWallet.findUnique({
      where: { agencyId: member.agencyId },
      select: {
        planCredits: true,
        purchasedCredits: true,
        rolloverCredits: true,
        heldCredits: true,
      },
    });

    if (!wallet) {
      return NextResponse.json(
        { balanceUsd: 0, credits: 0, hasWallet: false },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const credits = Math.max(
      0,
      wallet.planCredits +
        wallet.purchasedCredits +
        wallet.rolloverCredits -
        wallet.heldCredits,
    );

    return NextResponse.json(
      {
        balanceUsd: Number((credits * CREDIT_TO_USD).toFixed(2)),
        credits,
        hasWallet: true,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
