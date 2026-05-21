/**
 * SMB onboarding · server query.
 *
 * Surface: `getSmbOnboardingData(userId)` — returns the user's already-
 * claimed business (if any) so step 1 can confirm it. Returns
 * `EMPTY_SMB_ONBOARDING` when:
 *
 *   - no claimed business yet (Maria's first visit — common path)
 *   - in Vercel's build phase (NEXT_PHASE guard, INC-27 / Pattern 1)
 *   - Prisma throws (degrade to "looks empty" rather than 500)
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the build-phase
 * short-circuit AND the catch block both return the same EMPTY constant
 * so the shape parity is enforced at TypeScript compile time, not at
 * Vercel build time.
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')`. Onboarding state changes
 *     on user action (claim / skip), not autonomously — minutes is
 *     plenty fresh.
 *   - `cacheTag('smb-onboarding-${userId}')` so a future "claim"
 *     server action can `revalidateTag` at the right granularity.
 *
 * Per `.claude/rules/performance.md`, all `select`s are explicit; no
 * `findMany()` without a column list.
 *
 * Auth: the query does NOT enforce auth — the page handler MUST verify
 * the session and call `unauthorized()` before calling. Defence-in-
 * depth via `where: { ownerUserId }` still scopes to the caller's own
 * rows.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import { EMPTY_SMB_ONBOARDING, type SmbOnboardingData } from "./types";

export async function getSmbOnboardingData(
  userId: string,
): Promise<SmbOnboardingData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-onboarding-${userId}`);

  // Build-phase short-circuit · INC-27 / Pattern 1.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_ONBOARDING;
  }

  try {
    const business = await prisma.business.findFirst({
      where: { ownerUserId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, city: true },
    });

    if (!business) return EMPTY_SMB_ONBOARDING;

    return {
      ownedBusinessId: business.id,
      ownedBusinessName: business.name ?? "",
      ownedBusinessCity: business.city ?? "",
    };
  } catch {
    // Degrade gracefully rather than crashing the route on a transient
    // DB blip — Maria still sees the "no business linked" empty state
    // (which is the same UX a brand-new user gets).
    return EMPTY_SMB_ONBOARDING;
  }
}
