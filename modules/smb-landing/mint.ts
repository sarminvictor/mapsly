/**
 * Mint (or fetch) the landing page for a business.
 *
 * One LandingPage per business (businessId is unique). Idempotent — returns the
 * existing landing if there is one, otherwise generates a fresh unguessable
 * token (retrying on the astronomically-unlikely collision) and a cosmetic slug
 * from the business name. Server-only helper called by the admin action.
 */

import prisma from "@/lib/prisma";

import { generateLandingToken, slugifyBusinessName } from "./token";

export interface MintedLanding {
  token: string;
  slug: string;
  /** False when an existing landing was returned (not newly created). */
  created: boolean;
}

export async function ensureLandingForBusiness(
  businessId: string,
  createdByUserId?: string,
): Promise<MintedLanding | null> {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true },
  });
  if (!biz) return null;

  const existing = await prisma.landingPage.findUnique({
    where: { businessId },
    select: { token: true, slug: true },
  });
  if (existing) {
    return { token: existing.token, slug: existing.slug, created: false };
  }

  const slug = slugifyBusinessName(biz.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateLandingToken();
    try {
      const lp = await prisma.landingPage.create({
        data: {
          businessId,
          token,
          slug,
          createdByUserId: createdByUserId ?? null,
        },
        select: { token: true, slug: true },
      });
      return { token: lp.token, slug: lp.slug, created: true };
    } catch {
      // Unique-token collision (1 in ~10^16) → retry with a fresh token.
    }
  }
  return null;
}
