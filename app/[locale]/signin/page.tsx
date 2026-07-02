import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { SignInForm } from "./SignInForm";

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

  return (
    <main
      style={{
        background: "var(--color-bg)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          padding: "32px 28px",
          boxShadow:
            "0 1px 2px rgba(28,25,22,.04), 0 8px 24px rgba(28,25,22,.05)",
        }}
      >
        <div
          aria-hidden
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-serif)",
            fontSize: 22,
            fontWeight: 700,
            color: "var(--color-text)",
            letterSpacing: "-0.02em",
            marginBottom: 24,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "var(--color-coral)",
              boxShadow: "0 0 12px rgba(195,85,58,.5)",
            }}
          />
          mapsly
        </div>

        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 28,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--color-text)",
            margin: 0,
          }}
        >
          {t("title")}
        </h1>

        <p
          style={{
            margin: "10px 0 24px",
            color: "var(--color-text-2)",
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          {t("subtitle")}
        </p>

        <SignInForm
          intent={intent}
          landing={landing}
          audience={audience}
          invite={invite}
        />

        <p
          style={{
            marginTop: 18,
            color: "var(--color-text-3)",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          {t("legal")}
        </p>
      </div>
    </main>
  );
}
