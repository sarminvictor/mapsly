/**
 * SMB "My Business" · server queries.
 *
 * Surface: `getSmbMyBusinessData(userId)` — viewer's owned business +
 * services list. Returns EMPTY when:
 *
 *   - the viewer has no claimed business yet (pre-onboarding)
 *   - Vercel build phase (INC-27)
 *   - Prisma throws (degrade rather than 500)
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, every `'use cache'`
 * Prisma query short-circuits at build time. Same NEXT_PHASE guard
 * pattern as `modules/smb-settings/queries.ts`.
 *
 * Per `.claude/rules/caching.md`:
 *
 *   - `cacheLife('minutes')` — services edits should reflect quickly.
 *     Actions revalidate this tag after every mutation.
 *   - `cacheTag('smb-my-business-${userId}')` — per-user.
 *
 * Per `.claude/rules/security.md`, this helper does NOT enforce auth —
 * the page handler MUST call `auth()` + `unauthorized()` first.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_SMB_MY_BUSINESS,
  type BusinessServiceRow,
  type ServiceSource,
  type SmbMyBusinessData,
} from "./types";

export async function getSmbMyBusinessData(
  userId: string,
): Promise<SmbMyBusinessData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-my-business-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_MY_BUSINESS;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_MY_BUSINESS;
  }

  try {
    const business = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        province: true,
        category: true,
        website: true,
        phone: true,
        isClaimed: true,
        services: {
          orderBy: [
            { isActive: "desc" },
            { sortOrder: "asc" },
            { name: "asc" },
          ],
          select: {
            id: true,
            name: true,
            category: true,
            description: true,
            sortOrder: true,
            isActive: true,
            source: true,
          },
        },
      },
    });

    if (!business) {
      return EMPTY_SMB_MY_BUSINESS;
    }

    const services: BusinessServiceRow[] = business.services.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      description: s.description,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
      source: normalizeSource(s.source),
    }));

    return {
      ownedBusinessId: business.id,
      businessName: business.name,
      businessAddress: business.address,
      businessCity: business.city,
      businessProvince: business.province,
      businessCategory: business.category,
      businessWebsite: business.website,
      businessPhone: business.phone,
      isClaimed: business.isClaimed,
      services,
    };
  } catch {
    return EMPTY_SMB_MY_BUSINESS;
  }
}

function normalizeSource(raw: string): ServiceSource {
  if (raw === "auto:google" || raw === "auto:dom" || raw === "manual") {
    return raw;
  }
  return "manual";
}
