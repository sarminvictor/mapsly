/**
 * Resolve a signed-in user's "right portal" destination + label.
 *
 * Used by the marketing header to swap the "Sign in" CTA for a
 * role-aware portal link, and by the public-page `/signin` redirect
 * so already-authenticated visitors skip the form.
 *
 * Mirrors the dispatch logic in `app/[locale]/post-signin/page.tsx`:
 *
 *   1. ADMIN → /admin
 *   2. AgencyMember row exists → /discover (demand-driven agency entry)
 *   3. Default → /home (SMB)
 *
 * Returns a label-key (resolved by the caller via getTranslations)
 * plus a typed pathname. When `external` is true the destination sits
 * outside the next-intl locale tree — caller must use a plain `<a>`
 * (next-intl rejects undeclared pathnames at build time).
 *
 * Cheap · single User findUnique with a 1-row members include.
 */

import prisma from "@/lib/prisma";

export type PortalDestinationHref = "/home" | "/discover" | "/admin";

export type PortalDestinationLabelKey =
  | "open_dashboard"
  | "open_workspace"
  | "open_admin";

export interface PortalDestination {
  href: PortalDestinationHref;
  labelKey: PortalDestinationLabelKey;
  /** True when href lies outside next-intl pathnames (currently /admin). */
  external: boolean;
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
      return { href: "/admin", labelKey: "open_admin", external: true };
    }
    if (user.agencyMembers.length > 0) {
      return {
        href: "/discover",
        labelKey: "open_workspace",
        external: false,
      };
    }
    return { href: "/home", labelKey: "open_dashboard", external: false };
  } catch {
    return null;
  }
}
