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
  /** Candidate scope business ids (visible ∪ selected) — the sheet passes these
   *  so it can compute the SCOPED market-cell count for the selected/visible
   *  scope (per-cell families must price/run only the cells those leads belong
   *  to, not every market of the research). Bounded to the page + selection. */
  businessIds: z.array(z.string().min(1).max(64)).max(5000).default([]),
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
      /** businessId → cellKey for the passed candidate ids, so the sheet can
       *  derive the SCOPED cell count/keys for the selected/visible scope. */
      businessCells: Record<string, string>;
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

    const [marketCount, wallet, cellRows] = await Promise.all([
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
      // cellKey per candidate scope id — scoped to this discovery's cells so we
      // never leak another discovery's business. Empty when the sheet passes no
      // ids (the "whole research" open) → the sheet uses all cellKeys.
      parsed.data.businessIds.length > 0
        ? prisma.business.findMany({
            where: {
              id: { in: parsed.data.businessIds },
              cellKey: { in: discovery.cellKeys },
            },
            select: { id: true, cellKey: true },
          })
        : Promise.resolve([]),
    ]);
    const businessCells: Record<string, string> = {};
    for (const r of cellRows) if (r.cellKey) businessCells[r.id] = r.cellKey;

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
      businessCells,
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
