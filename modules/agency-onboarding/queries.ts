/**
 * Agency onboarding · server query.
 *
 * Surface: `getAgencyOnboardingData(userId)` — returns the user's first
 * AgencyMember's agency, the set of service-template keys that already
 * have a List (so step 2 can disable them), and the first 50 sample
 * top-rated businesses for the agency's default metro (or globally if
 * no metro set yet) so step 3 can preview leads.
 *
 * Returns `EMPTY_AGENCY_ONBOARDING` when:
 *
 *   - no AgencyMember yet (stray SMB user — page redirects to /dashboard)
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
 *     on user action (profile save / list creation), not autonomously.
 *   - `cacheTag('agency-onboarding-${userId}')` so server actions can
 *     `revalidateTag` at the right granularity.
 *
 * Per `.claude/rules/performance.md`, all `select`s are explicit.
 *
 * Auth: the query does NOT enforce auth — the page handler MUST verify
 * the session and call `unauthorized()` before calling.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";
import { SERVICE_TEMPLATE_BY_TYPE } from "@/modules/agency-portal/lists/service-templates";
import type { ListServiceTypeValue } from "@/modules/agency-portal/lists/types";

import {
  EMPTY_AGENCY_ONBOARDING,
  type AgencyOnboardingData,
  type AgencyOnboardingLeadPreview,
} from "./types";

const PREVIEW_TAKE = 50;

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
          select: { id: true, name: true, defaultMetro: true },
        },
      },
    });

    if (!membership?.agency) return EMPTY_AGENCY_ONBOARDING;

    const { agency } = membership;
    const defaultMetro = agency.defaultMetro ?? "";

    const [lists, businesses, totalActive] = await Promise.all([
      prisma.list.findMany({
        where: { agencyId: agency.id },
        select: { serviceType: true },
      }),
      prisma.business.findMany({
        where: {
          isActive: true,
          ...(defaultMetro ? { city: defaultMetro } : {}),
        },
        orderBy: { rating: "desc" },
        take: PREVIEW_TAKE,
        select: {
          id: true,
          name: true,
          city: true,
          category: true,
          rating: true,
          reviewCount: true,
        },
      }),
      prisma.business.count({ where: { isActive: true } }),
    ]);

    // Derive which template keys are already in use.
    const serviceTemplatesUsed: string[] = [];
    for (const row of lists) {
      const desc =
        SERVICE_TEMPLATE_BY_TYPE[row.serviceType as ListServiceTypeValue];
      if (desc && !serviceTemplatesUsed.includes(desc.key)) {
        serviceTemplatesUsed.push(desc.key);
      }
    }

    const sampleLeads: AgencyOnboardingLeadPreview[] = businesses.map((b) => ({
      id: b.id,
      name: b.name ?? "Unknown",
      city: b.city ?? "",
      category: b.category ?? "",
      rating: b.rating ?? 0,
      reviewCount: b.reviewCount ?? 0,
    }));

    const moreAvailable = Math.max(0, totalActive - sampleLeads.length);

    return {
      agencyId: agency.id,
      agencyName: agency.name ?? "",
      defaultMetro,
      serviceTemplatesUsed,
      sampleLeads,
      moreAvailable,
    };
  } catch {
    // Degrade gracefully rather than crashing the route on a transient
    // DB blip.
    return EMPTY_AGENCY_ONBOARDING;
  }
}
