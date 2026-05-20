// Pro Max 20x usage tracker · rolling 5h window approximation.
// Reads TokenUsage rows; the loop writes one per tick. We can't query
// Anthropic for "your real quota" so this is a local approximation.

import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

const WINDOW_HOURS = 5;
// Conservative estimate for Pro Max 20x · per Anthropic's published limits
// (these are rough · actual quota is rolling; tweak as we observe real usage)
const ESTIMATED_5H_INPUT_BUDGET = 1_000_000; // 1M tokens
const ESTIMATED_5H_OUTPUT_BUDGET = 200_000; // 200K tokens

export interface QuotaStatus {
  windowStartedAt: string; // when the oldest token in window was used
  resetEstimateAt: string; // oldest token + 5h
  windowEndsAt: string; // now + remaining of oldest
  tokensInputUsed: number;
  tokensOutputUsed: number;
  inputUsedPct: number;
  outputUsedPct: number;
  costEstimateUsd: number;
  activeSessions: number;
  rateLimitedRecent: number; // last 24h
  status: "ok" | "warn" | "near-limit" | "exceeded";
}

export async function getQuotaStatus(): Promise<QuotaStatus> {
  "use cache";
  cacheLife("minutes");
  cacheTag("dev-dashboard-quota");

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_HOURS * 3600_000);

  try {
    const usages = await prisma.tokenUsage.findMany({
      where: { occurredAt: { gte: windowStart } },
      orderBy: { occurredAt: "asc" },
    });

    const tokensInputUsed = usages.reduce((s, u) => s + u.tokensInput, 0);
    const tokensOutputUsed = usages.reduce((s, u) => s + u.tokensOutput, 0);
    const costEstimateUsd = usages.reduce(
      (s, u) => s + (u.costUsdEstimate ?? 0),
      0,
    );

    const inputUsedPct = Math.round(
      (tokensInputUsed / ESTIMATED_5H_INPUT_BUDGET) * 100,
    );
    const outputUsedPct = Math.round(
      (tokensOutputUsed / ESTIMATED_5H_OUTPUT_BUDGET) * 100,
    );

    const oldest = usages[0]?.occurredAt ?? now;
    const resetEstimate = new Date(oldest.getTime() + WINDOW_HOURS * 3600_000);

    let status: QuotaStatus["status"] = "ok";
    const pct = Math.max(inputUsedPct, outputUsedPct);
    if (pct >= 100) status = "exceeded";
    else if (pct >= 85) status = "near-limit";
    else if (pct >= 65) status = "warn";

    const active = await prisma.task.count({
      where: { status: "IN_PROGRESS" },
    });

    const rateLimited = await prisma.tokenUsage.count({
      where: {
        outcome: "rate-limit",
        occurredAt: { gte: new Date(now.getTime() - 86400_000) },
      },
    });

    return {
      windowStartedAt: oldest.toISOString(),
      resetEstimateAt: resetEstimate.toISOString(),
      windowEndsAt: resetEstimate.toISOString(),
      tokensInputUsed,
      tokensOutputUsed,
      inputUsedPct,
      outputUsedPct,
      costEstimateUsd,
      activeSessions: active,
      rateLimitedRecent: rateLimited,
      status,
    };
  } catch {
    return {
      windowStartedAt: now.toISOString(),
      resetEstimateAt: now.toISOString(),
      windowEndsAt: now.toISOString(),
      tokensInputUsed: 0,
      tokensOutputUsed: 0,
      inputUsedPct: 0,
      outputUsedPct: 0,
      costEstimateUsd: 0,
      activeSessions: 0,
      rateLimitedRecent: 0,
      status: "ok",
    };
  }
}
