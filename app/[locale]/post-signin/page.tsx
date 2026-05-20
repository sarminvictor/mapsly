import { unauthorized } from "next/navigation";
import { connection } from "next/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { type Locale } from "@/i18n/routing";
import prisma from "@/lib/prisma";

// Post-signin landing. The magic-link callback drops the user here, we look
// up their role + agency membership, then redirect by audience.
//
// Order of precedence:
//   1. ADMIN → /admin             (not yet built — falls back to /dashboard)
//   2. AgencyMember row exists    → /lists
//   3. Default                    → /dashboard (SMB)
//
// Marked dynamic via `auth()` (which reads cookies) so PPR doesn't try to
// prerender this — it's user-specific by definition.
export default async function PostSignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Mark dynamic under cacheComponents (PPR) — this route depends on
  // the user's session cookie, must not be prerendered.
  await connection();

  const { locale } = (await params) as { locale: Locale };
  const session = await auth();

  if (!session?.user?.id) {
    unauthorized();
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      agencyMembers: { select: { agencyId: true }, take: 1 },
    },
  });

  // Defensive: session points at a user that no longer exists.
  if (!user) unauthorized();

  if (user.role === "ADMIN") {
    // /admin doesn't exist yet (Phase H) — fall through to dashboard so
    // existing admin sign-ins still land somewhere sensible.
    redirect({ href: "/dashboard", locale });
  }

  if (user.agencyMembers.length > 0) {
    redirect({ href: "/lists", locale });
  }

  redirect({ href: "/dashboard", locale });
}
