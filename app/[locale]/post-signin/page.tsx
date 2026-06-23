import { Suspense } from "react";
import { headers } from "next/headers";
import { unauthorized, redirect as nativeRedirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { type Locale } from "@/i18n/routing";
import prisma from "@/lib/prisma";
import { startSmbCheckoutFromLanding } from "@/modules/smb-landing/checkout-intent";

// Post-signin landing. The magic-link callback drops the user here, we look
// up their role + agency membership, then redirect by audience.
//
// Order of precedence:
//   1. ADMIN → /admin (outside next-intl tree — native redirect)
//   2. AgencyMember row exists    → /discover (demand-driven agency entry)
//   3. Default                    → /home (SMB)
//
// Under cacheComponents (PPR), the outer page must be sync — async work
// (auth + DB query) goes inside <Suspense> so the static shell renders
// without blocking. Inner component does the redirect once it resolves.
export default function PostSignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <PostSignInRedirect params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function PostSignInRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = (await params) as { locale: Locale };
  const sp = await searchParams;
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
    redirect({ href: "/discover", locale });
  }

  // Landing-driven SMB checkout intent — best-effort. A freshly-authed visitor
  // who arrived via a /l/[token] CTA goes straight into the $29 checkout
  // (attributed to the landing). Any failure falls through to /home, so a
  // landing intent can never block a normal sign-in.
  const intent = typeof sp.intent === "string" ? sp.intent : undefined;
  const landing = typeof sp.landing === "string" ? sp.landing : undefined;
  if (intent === "smb") {
    const checkoutUrl = await startSmbCheckoutFromLanding(
      session.user.id,
      landing,
      await currentOrigin(),
    );
    if (checkoutUrl) nativeRedirect(checkoutUrl);
  }

  redirect({ href: "/home", locale });

  // Unreachable — redirect() throws. Return null so TS infers ReactNode.
  return null;
}

/** Request origin (proto + host) for building the Stripe return URL. */
async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}
