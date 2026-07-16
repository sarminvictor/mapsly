import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { SignInForm } from "./SignInForm";
import { SignInShell } from "./SignInShell";
import { GoogleSignInButton } from "./GoogleSignInButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signin" });
  return {
    title: `${t("title")} · Mapsly`,
    description: t("subtitle"),
    robots: { index: false, follow: false },
  };
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.signin");

  // Landing CTA carries `?intent=smb&landing=<token>` so the magic-link flow
  // can resume into the $29 checkout after sign-in. The /for-agencies CTAs
  // carry `?audience=agency` the same way (WP2-1 self-serve agency creation).
  const sp = await searchParams;
  const intent = typeof sp.intent === "string" ? sp.intent : undefined;
  const landing = typeof sp.landing === "string" ? sp.landing : undefined;
  const audience = sp.audience === "agency" ? "agency" : undefined;
  // Auth.js redirects OAuth failures back here as `?error=<code>`; our own
  // flows add `verify_email` (google-link gate) and `rate_limited`. Without
  // this mapping a failed Google sign-in lands on a pristine form with zero
  // feedback. `checkout` (stripe fallback) keeps its silent behavior — the
  // magic-link form IS its recovery path. Unknown codes show the generic line.
  const errorParam = typeof sp.error === "string" ? sp.error : undefined;
  const errorMsg =
    errorParam === "verify_email"
      ? t("error_verify_email")
      : errorParam === "rate_limited"
        ? t("error_rate_limited")
        : errorParam && errorParam !== "checkout"
          ? t("error_google_generic")
          : undefined;
  // WP5-8 · seat-invite token from the team email (format-validated; rides
  // the magic-link round-trip so /post-signin can seat the invitee).
  const invite =
    typeof sp.invite === "string" && /^[a-f0-9]{48}$/.test(sp.invite)
      ? sp.invite
      : undefined;

  // If the visitor is already signed in, skip the form and route
  // through /post-signin which dispatches by role (admin / agency /
  // SMB). This matches the marketing header swap: a logged-in user
  // who lands on /signin shouldn't have to re-enter their email.
  // The agency marker rides along so an already-signed-in user clicking
  // the agency CTA still gets provisioned (WP2-1); an invite token rides
  // along so an already-signed-in invitee still gets seated (WP5-8).
  const session = await auth();
  if (session?.user?.id) {
    redirect({
      href: invite
        ? { pathname: "/post-signin", query: { invite } }
        : audience
          ? { pathname: "/post-signin", query: { audience } }
          : "/post-signin",
      locale: locale as Locale,
    });
  }

  // The homepage hero's free-leads capsule, echoed above the card so the
  // offer follows the visitor into sign-in (en fallback covers all locales).
  // Hidden for SMB checkout arrivals (?intent=smb) — the agency free-leads
  // offer is off-voice for Maria's paid flow (two-audience rule).
  const tAg = await getTranslations("for_agencies");

  return (
    <SignInShell
      badge={intent === "smb" ? undefined : tAg("hero.pill")}
      homeLabel={t("logo_home")}
    >
      <h1 className="si-h1">{t("title")}</h1>

      <p className="si-sub">{t("subtitle")}</p>

      {errorMsg ? (
        <p role="alert" className="si-alert">
          {errorMsg}
        </p>
      ) : null}

      <GoogleSignInButton label={t("google_cta")} invite={invite} />

      {/* Purely visual divider — aria-hidden (no role: a separator role
          inside aria-hidden is never exposed, and announcing "or" between
          the Google button and the email field adds nothing). */}
      <div aria-hidden className="si-divider">
        <span />
        {t("or")}
        <span />
      </div>

      <SignInForm
        intent={intent}
        landing={landing}
        audience={audience}
        invite={invite}
      />

      <p className="si-legal">{t("legal")}</p>
    </SignInShell>
  );
}
