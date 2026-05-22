/**
 * Cross-portal access guard · enforces the SMB ↔ Agency boundary.
 *
 * Mapsly has two distinct portals with two distinct UX languages
 * (Maria's SMB cream-coral cosmos vs Tom's agency cool-gray-indigo
 * workbench). Showing the wrong portal to the wrong audience is a
 * defect — Maria would be lost in Tom's dense filter grids, and
 * Tom doesn't want to see review-reply drafts.
 *
 * Resolution rules (mirror `lib/portal-destination.ts` and the
 * `/post-signin` dispatch):
 *
 *   1. `User.role === "ADMIN"` → passes ALL guards (admins can debug
 *      both portals).
 *   2. `AgencyMember` row exists → ONLY the agency portal. SMB pages
 *      bounce the user to `/lists`.
 *   3. Default (no admin, no agency membership) → ONLY the SMB
 *      portal. Agency pages bounce the user to `/dashboard`.
 *
 * Usage from a portal page:
 *
 *   const session = await auth();
 *   if (!session?.user?.id) unauthorized();
 *   const mismatch = await requirePortal(session.user.id, "smb");
 *   if (mismatch) redirect({ href: mismatch.redirectTo, locale: locale as Locale });
 *
 * The function returns `null` when the user is allowed on the
 * supplied portal. Returns a redirect-target object otherwise; the
 * caller invokes `redirect()` (next-intl typed) so the route stays
 * inside the i18n routing config.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 — this helper is
 * called INSIDE the Suspense-wrapped async body of each page, never
 * from the layout or the sync default export.
 *
 * Per `.claude/rules/security.md` — the function looks up the user's
 * role + AgencyMember row from a single Prisma query (no N+1; cheap
 * indexed lookups). Cross-agency leak is structurally impossible
 * because we only read about the signed-in user.
 */

import prisma from "@/lib/prisma";

/** Which portal a route lives under. */
export type PortalKind = "smb" | "agency";

/**
 * Returned when the signed-in user is on the WRONG portal for their
 * resolved identity. The caller redirects with next-intl's typed
 * `redirect({ href, locale })`.
 */
export interface PortalMismatch {
  /** Where the user should go. */
  redirectTo: "/dashboard" | "/lists";
  /**
   * Short reason · "agency-member-on-smb" / "smb-on-agency". Useful
   * for telemetry / Sentry tags so we can see how often each side
   * triggers a redirect.
   */
  reason: "agency-member-on-smb" | "smb-on-agency";
}

/**
 * Build-phase short-circuit: Vercel's prerender worker calls page
 * components without a session. The page handler already bounces on
 * `auth()` returning null (via `unauthorized()`), so this helper
 * never executes during build — but we keep the guard for parity
 * with every other Prisma helper per cache-components Pattern 1.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Resolve the user's allowed portal and, if it differs from the
 * `requested` portal, return the redirect target.
 *
 * @param userId — signed-in user id (caller has already enforced auth)
 * @param requested — the portal the user is trying to access
 * @returns `null` if the user is allowed on the requested portal,
 *   otherwise a `PortalMismatch` with the redirect target.
 */
export async function requirePortal(
  userId: string,
  requested: PortalKind,
): Promise<PortalMismatch | null> {
  if (isBuildPhase()) return null;
  if (!userId || typeof userId !== "string") return null;

  try {
    // One round-trip · pulls the role + first agency membership.
    // We don't `take: 1` the membership; the existence check is
    // enough and Prisma's `agencyMembers` relation is indexed on
    // `userId` (composite UNIQUE on `userId`+`agencyId`).
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        agencyMembers: { select: { agencyId: true }, take: 1 },
      },
    });

    if (!user) return null; // unknown user · caller's auth gate should have caught this

    // ADMIN passes every guard. Sentry can still tag the request
    // with `portal_admin_override` if we want to track admin
    // debugging activity later.
    if (user.role === "ADMIN") return null;

    const isAgencyMember = user.agencyMembers.length > 0;

    if (requested === "smb" && isAgencyMember) {
      // Agency member trying to load an SMB route — push them back
      // to their workbench.
      return { redirectTo: "/lists", reason: "agency-member-on-smb" };
    }
    if (requested === "agency" && !isAgencyMember) {
      // SMB user (no agency membership) trying to load an agency
      // route — push them back to their dashboard.
      return { redirectTo: "/dashboard", reason: "smb-on-agency" };
    }

    return null;
  } catch {
    // Degrade-open · if the lookup fails we let the page render
    // rather than redirect-loop the user. The page's own auth
    // checks remain the primary defence.
    return null;
  }
}
