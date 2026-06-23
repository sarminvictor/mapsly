// modules/campaign/actions.ts · agency campaign intake server actions (Phase 8)
//
//   - createCampaignAction(input)  — persists a Campaign row + a costed
//     ResearchPlan derived from mapCampaignToStrategy. OWNER/ADMIN/STAFF of an
//     agency may create campaigns (any signed-in agency member).
//   - getStrategyAction(input)     — pure preview: returns the strategy that
//     WOULD be persisted, without writing anything (for the live intake form).
//
// Auth: every action checks auth() first and throws "unauthorized" if absent,
// per .claude/rules/security.md. Validation: every input parses via Zod first,
// per .claude/rules/validation-and-errors.md.
//
// The ResearchPlan cost estimate is deterministic (sum of per-enrichment unit
// prices from modules/cost/pricing.ts) — no live pricing call.
//
// See:
//   - modules/campaign/strategy.ts  — mapCampaignToStrategy (pure)
//   - modules/cost/pricing.ts        — ENRICHMENT_PRICES
//   - prisma/schema.prisma           — Campaign / ResearchPlan

"use server";

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma, { Prisma } from "@/lib/prisma";
import { ENRICHMENT_PRICES } from "@/modules/cost/pricing";

import { mapCampaignToStrategy, type CampaignStrategy } from "./strategy";

/** Intake schema · all free-text fields bounded. */
const CampaignInputSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  sellingWhat: z.string().min(1, "selling_what_required").max(2000),
  buyerIcp: z.string().max(2000).optional(),
  painPoints: z.string().max(2000).optional(),
  budgetHintUsd: z.number().nonnegative().max(1_000_000).optional(),
});

export type CampaignInput = z.infer<typeof CampaignInputSchema>;

/** Result of a successful create. */
export interface CreateCampaignResult {
  campaignId: string;
  researchPlanId: string;
  strategy: CampaignStrategy;
  estimatedCostUsd: number;
}

/** Resolve the viewer's first AgencyMember (their default agency). */
async function requireAgencyId(userId: string): Promise<string> {
  const membership = await prisma.agencyMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { agencyId: true },
  });
  if (!membership) throw new Error("forbidden");
  return membership.agencyId;
}

/**
 * Rough per-business cost of running every recommended enrichment once. Cell-
 * scoped enrichments (meta_ads) are attributed at their per-unit cost. This is
 * a planning estimate, NOT a charge — the cost-counter bills actual runs.
 */
function estimatePlanCostUsd(strategy: CampaignStrategy): number {
  let total = 0;
  for (const e of strategy.recommendedEnrichments) {
    const price = ENRICHMENT_PRICES[e];
    if (price) total += price.usdPerUnit;
  }
  return Number(total.toFixed(4));
}

/**
 * Create a campaign and its initial costed research plan. Persists:
 *   - Campaign           — the intake (selling-what / buyer-ICP / pain points),
 *                          plus the proposed plan + signal weights as JSON.
 *   - ResearchPlan       — the strategy serialized + an estimated cost.
 *
 * Returns the new ids + the resolved strategy for the UI to render.
 */
export async function createCampaignAction(
  input: CampaignInput,
): Promise<CreateCampaignResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = session.user.id;
  const agencyId = await requireAgencyId(userId);

  const parsed = CampaignInputSchema.parse(input);
  const strategy = mapCampaignToStrategy({
    sellingWhat: parsed.sellingWhat,
    buyerIcp: parsed.buyerIcp,
    painPoints: parsed.painPoints,
  });
  const estimatedCostUsd = estimatePlanCostUsd(strategy);

  // The strategy is plain, JSON-serializable data. Prisma's InputJson*
  // structural type rejects interface-typed arrays (no index signature) even
  // though the runtime value is valid JSON, so we widen via `unknown`.
  const planJson = {
    recommendedCategories: strategy.recommendedCategories,
    recommendedEnrichments: strategy.recommendedEnrichments,
    signalWeights: strategy.signalWeights,
    suggestedFilters: strategy.suggestedFilters,
    rationale: strategy.rationale,
  } as unknown as Prisma.InputJsonValue;

  const { campaign, plan } = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        agencyId,
        createdByUserId: userId,
        name: parsed.name ?? null,
        sellingWhat: parsed.sellingWhat,
        buyerIcp: parsed.buyerIcp ?? null,
        painPoints: parsed.painPoints ?? null,
        budgetHintUsd: parsed.budgetHintUsd ?? null,
        proposedPlanJson: planJson,
        signalWeightsJson:
          strategy.signalWeights as unknown as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
    const plan = await tx.researchPlan.create({
      data: {
        campaignId: campaign.id,
        planJson,
        estimatedCostUsd,
      },
      select: { id: true },
    });
    return { campaign, plan };
  });

  return {
    campaignId: campaign.id,
    researchPlanId: plan.id,
    strategy,
    estimatedCostUsd,
  };
}

/** Input for the preview action (same shape, no name/budget needed). */
const StrategyInputSchema = z.object({
  sellingWhat: z.string().min(1, "selling_what_required").max(2000),
  buyerIcp: z.string().max(2000).optional(),
  painPoints: z.string().max(2000).optional(),
});

export type StrategyInput = z.infer<typeof StrategyInputSchema>;

export interface GetStrategyResult {
  strategy: CampaignStrategy;
  estimatedCostUsd: number;
}

/**
 * Preview the strategy + cost for an intent WITHOUT persisting anything. Used by
 * the live intake form so the agency sees the plan update as they type.
 */
export async function getStrategyAction(
  input: StrategyInput,
): Promise<GetStrategyResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");

  const parsed = StrategyInputSchema.parse(input);
  const strategy = mapCampaignToStrategy(parsed);
  return { strategy, estimatedCostUsd: estimatePlanCostUsd(strategy) };
}
