/**
 * `/api/agency/wallet` · the caller's live agency credit balance for the topbar
 * WalletPill island.
 *
 * GET → `{ credits: number }` — the AVAILABLE balance, mirroring
 * `WalletPill.readCredits` EXACTLY so SSR and the client poll agree:
 *   credits = max(0, planCredits + purchasedCredits + rolloverCredits − heldCredits)
 * A missing wallet → 0. The client (components/agency/WalletPillLive.tsx) polls
 * this every few seconds so a HOLD or SETTLE surfaces within seconds instead of
 * only on the next navigation.
 *
 * Per `.claude/rules/security.md`:
 *   - Auth-gated · agency resolved from the session, never a query param.
 *   - No cross-agency leak · the wallet is scoped to the resolved agencyId.
 *   - Non-member → 403 (same shape as `/api/agency/jobs`).
 *
 * Per `.claude/rules/cost-discipline.md` · no external API calls, no CronRun.
 * Per `.claude/rules/performance.md` · a single indexed Prisma round-trip,
 * `private, no-store` (wallet is per-agency, must never be shared-cached).
 *
 * Degrades gracefully: any read failure returns `{ credits: 0 }` rather than
 * throwing, so the pill keeps a sane value and the topbar never 500s.
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(): Promise<NextResponse> {
  try {
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

    const wallet = await prisma.agencyWallet.findUnique({
      where: { agencyId: member.agencyId },
      select: {
        planCredits: true,
        purchasedCredits: true,
        rolloverCredits: true,
        heldCredits: true,
      },
    });

    const credits = wallet
      ? Math.max(
          0,
          wallet.planCredits +
            wallet.purchasedCredits +
            wallet.rolloverCredits -
            wallet.heldCredits,
        )
      : 0;

    return NextResponse.json(
      { credits },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    // Never throw from the topbar's balance poll — show a sane value instead.
    return NextResponse.json(
      { credits: 0 },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
