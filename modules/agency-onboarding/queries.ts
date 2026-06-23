/**
 * Agency onboarding · server query.
 *
 * Surface: `getAgencyOnboardingData(userId)` — returns the user's first
 * AgencyMember's agency profile (id, name, defaultMetro, categoriesServed)
 * so the lean setup page can pre-fill the profile form.
 *
 * Returns `EMPTY_AGENCY_ONBOARDING` (agencyId === "") when:
 *
 *   - no AgencyMember yet (stray SMB user — page redirects to /home)
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
 *     on user action (profile save), not autonomously.
 *   - `cacheTag('agency-onboarding-${userId}')` so the server action can
 *     `revalidateTag` at the right granularity.
 *
 * Per `.claude/rules/performance.md`, all `select`s are explicit.
 *
 * Auth: the query does NOT enforce auth — the page handler MUST verify
 * the session and call `unauthorized()` before calling.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import { EMPTY_AGENCY_ONBOARDING, type AgencyOnboardingData } from "./types";

export async function getAgencyOnboardingData(
  userId: string,
): Promise<AgencyOnboardingData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`agency-onboarding-${userId}`);

  // Build-phase short-circuit · INC-27 / Pattern 1.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_AGENCY_ONBOARDING;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_AGENCY_ONBOARDING;
  }

  try {
    const membership = await prisma.agencyMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        agency: {
          select: {
            id: true,
            name: true,
            defaultMetro: true,
            categoriesServed: true,
          },
        },
      },
    });

    if (!membership?.agency) return EMPTY_AGENCY_ONBOARDING;

    const { agency } = membership;

    return {
      agencyId: agency.id,
      agencyName: agency.name ?? "",
      defaultMetro: agency.defaultMetro ?? "",
      categoriesServed: (agency.categoriesServed ?? []).join(", "),
    };
  } catch {
    // Degrade gracefully rather than crashing the route on a transient
    // DB blip.
    return EMPTY_AGENCY_ONBOARDING;
  }
}
