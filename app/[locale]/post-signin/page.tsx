import { Suspense } from "react";
import { headers } from "next/headers";
import { unauthorized, redirect as nativeRedirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import { type Locale } from "@/i18n/routing";
import prisma from "@/lib/prisma";
import { startSmbCheckoutFromLanding } from "@/modules/smb-landing/checkout-intent";
import { provisionAgencyForUser } from "@/modules/agency-portal/provision";
import { acceptPendingInvite } from "@/modules/agency-portal/team/accept";

// Post-signin landing. The magic-link callback drops the user here, we look
// up their role + agency membership, then redirect by audience.
//
// Order of precedence:
//   1. ADMIN → /admin (outside next-intl tree — native redirect)
//   2. AgencyMember row exists    → /welcome (agency portal front door)
//   3. `?audience=agency` marker  → self-serve agency provisioning (WP2-1):
//                                   Agency + AgencyMember(OWNER) + wallet,
//                                   then /welcome. Fires ONLY on the explicit
//                                   marker AND for users who own no SMB
//                                   business — an existing SMB owner is never
//                                   silently converted into an agency.
//   4. Default                    → /home (SMB)
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
      email: true,
      agencyMembers: { select: { agencyId: true }, take: 1 },
      // WP2-1 guard input: does this user already own an SMB business?
      ownedBusinesses: { select: { id: true }, take: 1 },
    },
  });

  // Defensive: session points at a user that no longer exists.
  if (!user) unauthorized();

  if (user.role === "ADMIN") {
    // /admin sits OUTSIDE the next-intl tree — use the native redirect
    // (next-intl's redirect would prefix the locale and break the path).
    nativeRedirect("/admin");
  }

  // WP5-8 · seat invite. Runs BEFORE the member/self-provision routing so an
  // invited user joins the INVITING agency (never provisions their own — see
  // docs/seat-model.md). The accept path enforces email-match + the seat cap;
  // any failure falls through to normal routing (an expired invite must never
  // block a sign-in) with the outcome logged inside acceptPendingInvite.
  const inviteToken = typeof sp.invite === "string" ? sp.invite : undefined;
  if (inviteToken && /^[a-f0-9]{48}$/.test(inviteToken)) {
    const accepted = await acceptPendingInvite(
      session.user.id,
      user.email,
      inviteToken,
    );
    if (accepted.status === "accepted") {
      redirect({ href: "/welcome", locale });
    }
  }

  if (user.agencyMembers.length > 0) {
    redirect({ href: "/welcome", locale });
  }

  // WP2-1 · self-serve agency creation. The /for-agencies CTAs send
  // `?audience=agency` through the magic-link round-trip (signin/actions.ts
  // bakes it into redirectTo), so its presence here is EXPLICIT agency intent.
  // Guard: a user who already owns an SMB business falls through to normal
  // routing — clicking an agency ad must never silently convert Maria's
  // account. Provisioning failures also fall through (a broken provision can't
  // block sign-in); the user can retry from the landing CTA.
  const audience = typeof sp.audience === "string" ? sp.audience : undefined;
  if (audience === "agency" && user.ownedBusinesses.length === 0) {
    let provisioned = false;
    let blocked: string | undefined;
    try {
      const result = await provisionAgencyForUser(session.user.id, user.email);
      // WP7-5 · a disposable-email signup is refused (no agency, no free grant).
      if (result.blocked) blocked = result.blocked;
      else provisioned = result.agencyId !== null;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "agency.self_provision.failed",
          userId: session.user.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    if (blocked) {
      // Bounce back to the agency landing with a "use a business email" note.
      // (No agency was created — routing into /welcome would break.)
      redirect({
        href: {
          pathname: "/for-agencies",
          query: { signup: "business_email_required" },
        },
        locale,
      });
    }
    if (provisioned) {
      // /welcome grants the 50 free credits (grantFreeTierIfNew — the single
      // grant path) and shows the agency front door.
      redirect({ href: "/welcome", locale });
    }
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
