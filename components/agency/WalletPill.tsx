/**
 * WalletPill · the topbar HUD credit balance (Phase 9).
 *
 * Server component: reads the caller's AgencyWallet directly (no API hop) for a
 * correct first paint, then hands the value to the `WalletPillLive` client
 * island, which polls `GET /api/agency/wallet` so the number stays fresh after a
 * HOLD or SETTLE (the static server render alone would go stale until the user
 * navigated). When the agency has no wallet (or a zero balance) the pill shows
 * "0 credits — add" so the affordance to top up is always present.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 · this is an async component
 * mounted inside a `<Suspense>` boundary in the layout topbar, so the shell can
 * prerender while the wallet read streams in. No `export const dynamic`.
 *
 * Per `.claude/rules/security.md` · agency resolved from the session; no wallet
 * for non-members → renders nothing (the topbar simply omits the pill, and the
 * live island never mounts for them).
 *
 * Degrades gracefully: any read failure renders the "add credits" pill rather
 * than throwing (keeps the topbar — and the build — green).
 */

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

import { WalletPillLive } from "./WalletPillLive";

async function readCredits(): Promise<number | null> {
  try {
    const session = await auth();
    if (!session?.user?.id) return null;

    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: { agencyId: true },
    });
    if (!member) return null;

    const wallet = await prisma.agencyWallet.findUnique({
      where: { agencyId: member.agencyId },
      select: {
        planCredits: true,
        purchasedCredits: true,
        rolloverCredits: true,
        heldCredits: true,
      },
    });
    if (!wallet) return 0;

    return Math.max(
      0,
      wallet.planCredits +
        wallet.purchasedCredits +
        wallet.rolloverCredits -
        wallet.heldCredits,
    );
  } catch {
    // Read failed — show the empty affordance, never crash the topbar.
    return 0;
  }
}

export async function WalletPill() {
  const credits = await readCredits();

  // Non-member (or signed-out) → omit the pill entirely.
  if (credits === null) return null;

  // Correct SSR value, then the client island keeps it live.
  return <WalletPillLive initial={credits} />;
}
