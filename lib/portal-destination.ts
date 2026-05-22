/**
 * Resolve a signed-in user's "right portal" destination + label.
 *
 * Used by the marketing header to swap the "Sign in" CTA for a
 * role-aware portal link, and by the public-page `/signin` redirect
 * so already-authenticated visitors skip the form.
 *
 * Mirrors the dispatch logic in `app/[locale]/post-signin/page.tsx`:
 *
 *   1. ADMIN → /dashboard (until Phase H admin lands)
 *   2. AgencyMember row exists → /lists
 *   3. Default → /dashboard (SMB)
 *
 * Returns a label-key (resolved by the caller via getTranslations)
 * plus a typed pathname the caller can pass to next-intl's Link.
 *
 * Cheap · single User findUnique with a 1-row members include.
 */

import prisma from "@/lib/prisma";

export type PortalDestinationHref = "/dashboard" | "/lists";

export type PortalDestinationLabelKey =
  | "open_dashboard"
  | "open_workspace"
  | "open_admin";

export interface PortalDestination {
  href: PortalDestinationHref;
  labelKey: PortalDestinationLabelKey;
}

/**
 * Resolve the portal destination for the given userId, or null if
 * the user no longer exists. Build-phase short-circuits to null so
 * Vercel's prerender doesn't hit Neon (cache-components Pattern 1).
 */
export async function getPortalDestination(
  userId: string,
): Promise<PortalDestination | null> {
  if (process.env.NEXT_PHASE === "phase-production-build") return null;
  if (!userId || typeof userId !== "string") return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        agencyMembers: { select: { agencyId: true }, take: 1 },
      },
    });
    if (!user) return null;

    if (user.role === "ADMIN") {
      // /admin doesn't ship until Phase H · fall back to dashboard so
      // existing admin links keep landing somewhere sensible.
      return { href: "/dashboard", labelKey: "open_admin" };
    }
    if (user.agencyMembers.length > 0) {
      return { href: "/lists", labelKey: "open_workspace" };
    }
    return { href: "/dashboard", labelKey: "open_dashboard" };
  } catch {
    return null;
  }
}
