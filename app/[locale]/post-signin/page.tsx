import { Suspense } from "react";
import { unauthorized, redirect as nativeRedirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { type Locale } from "@/i18n/routing";
import prisma from "@/lib/prisma";

// Post-signin landing. The magic-link callback drops the user here, we look
// up their role + agency membership, then redirect by audience.
//
// Order of precedence:
//   1. ADMIN → /admin (outside next-intl tree — native redirect)
//   2. AgencyMember row exists    → /lists
//   3. Default                    → /home (SMB)
//
// Under cacheComponents (PPR), the outer page must be sync — async work
// (auth + DB query) goes inside <Suspense> so the static shell renders
// without blocking. Inner component does the redirect once it resolves.
export default function PostSignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <PostSignInRedirect params={params} />
    </Suspense>
  );
}

async function PostSignInRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
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
    // /admin sits OUTSIDE the next-intl tree — use the native redirect
    // (next-intl's redirect would prefix the locale and break the path).
    nativeRedirect("/admin");
  }

  if (user.agencyMembers.length > 0) {
    redirect({ href: "/lists", locale });
  }

  redirect({ href: "/home", locale });

  // Unreachable — redirect() throws. Return null so TS infers ReactNode.
  return null;
}
