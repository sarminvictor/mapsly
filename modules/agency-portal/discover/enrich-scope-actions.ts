"use server";

/**
 * Enrich-scope read action (WP5-3) — what the in-workbench EnrichMoreSheet
 * needs to quote a run: the discovery's cellKeys (per-cell families price per
 * cell no matter which businesses are scoped), the whole-market enrichable
 * business count (the "whole research" scope option), and the wallet balance
 * (in credits) for the affordability line.
 *
 * Auth-gated + Zod-validated per `.claude/rules/security.md`; the discovery
 * must belong to the caller's agency. Pure Prisma reads — no external API.
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rawListWhere } from "@/modules/discovery/raw-list";

const Input = z.object({
  discoveryId: z.string().min(1).max(64),
});

export type EnrichScopeResult =
  | {
      status: "ok";
      cellKeys: string[];
      /** Whole-market business count (default-excluded view) — the "whole
       *  research" scope size shown per family row before pricing. */
      marketCount: number;
      /** Wallet balance in credits (plan + purchased + rollover − held). */
      walletCredits: number;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function getEnrichScopeAction(
  input: unknown,
): Promise<EnrichScopeResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };

    const discovery = await prisma.discovery.findUnique({
      where: { id: parsed.data.discoveryId },
      select: { agencyId: true, cellKeys: true },
    });
    if (!discovery || discovery.agencyId !== member.agencyId) {
      return { status: "forbidden" };
    }

    const [marketCount, wallet] = await Promise.all([
      prisma.business.count({
        where: rawListWhere({ cellKeys: discovery.cellKeys }),
      }),
      prisma.agencyWallet.findUnique({
        where: { agencyId: member.agencyId },
        select: {
          planCredits: true,
          purchasedCredits: true,
          rolloverCredits: true,
          heldCredits: true,
        },
      }),
    ]);

    const walletCredits = wallet
      ? Math.max(
          0,
          wallet.planCredits +
            wallet.purchasedCredits +
            wallet.rolloverCredits -
            wallet.heldCredits,
        )
      : 0;

    return {
      status: "ok",
      cellKeys: discovery.cellKeys,
      marketCount,
      walletCredits,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "enrich.scope.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
