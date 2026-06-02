/**
 * SMB settings · `/(smb)/settings`.
 *
 * Maria's account + housekeeping surface. Cards, in order:
 *
 *   1. Your account · email (read-only sign-in identity) + editable name + Save.
 *   2. Language · English for now — a "Coming soon" placeholder. Locale
 *      support stays wired for later (see `i18n/routing.ts`); there's no
 *      switcher and no auto-detection — everyone gets English.
 *   3. Billing · link to /settings/billing.
 *   4. Sign out · server action invoking NextAuth `signOut()`.
 *
 * (The old "Your business" card duplicated /my-business; the brand-voice and
 * notifications placeholders were removed.)
 *
 * Per `.claude/rules/cache-components.md`: Pattern 2 (sync export + Suspense'd
 * async body) and Pattern 1 (the cached query NEXT_PHASE-guards to EMPTY).
 *
 * Per `.claude/rules/ui-ux-smb.md`: warm, plain English, 44px tap targets.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { requirePortal } from "@/lib/portal-guard";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  getSmbSettingsData,
  signOutFromSettings,
} from "@/modules/smb-settings";
import { AccountCard } from "@/modules/smb-settings/components/AccountCard";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "smb.settings.index.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    // Authenticated route — keep out of search results.
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

/**
 * Default export · SYNC shell with a Suspense'd async body. The shell
 * does ZERO async work so cacheComponents can prerender it.
 */
export default function SmbSettingsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsBody params={params} />
    </Suspense>
  );
}

function SettingsSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <div
        style={{
          height: 28,
          width: 200,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            height: 140,
            background: "var(--color-bg-2)",
            borderRadius: 16,
            marginBottom: 16,
          }}
        />
      ))}
    </section>
  );
}

/**
 * Async body · auth + DB + render. Lives inside the Suspense boundary
 * so the page shell remains prerenderable. Throws redirect via
 * `unauthorized()` for anon visitors (Next 16 auth interrupts).
 */
async function SettingsBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  // Cross-portal guard · agency members get bounced to /lists so the
  // SMB portal is reserved for Maria + non-agency users (ADMIN passes
  // through). Per `lib/portal-guard.ts`.
  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const t = await getTranslations("smb.settings.index");
  const data = await getSmbSettingsData(session.user.id);

  return (
    <section
      aria-labelledby="settings-heading"
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-3)",
          }}
        >
          {t("eyebrow")}
        </p>
        <h1
          id="settings-heading"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 36px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: "6px 0 0",
            color: "var(--color-text)",
          }}
        >
          {t("title")}
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--color-text-2)",
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          {t("subtitle")}
        </p>
      </header>

      <AccountCard
        userEmail={data.userEmail}
        userName={data.userName}
        labels={{
          heading: t("identity_heading"),
          emailLabel: t("identity_email_label"),
          emailNote: t("identity_email_note"),
          nameLabel: t("identity_name_label"),
          namePlaceholder: t("identity_name_placeholder"),
          saveCta: t("identity_save_cta"),
          saving: t("identity_saving"),
          saved: t("identity_saved"),
          error: t("identity_error"),
        }}
      />

      <LanguageCard
        labels={{
          heading: t("language_heading"),
          subtitle: t("language_subtitle"),
          locale_label: t("language_locale_label"),
          locale_en: t("language_locale_en"),
          coming_soon: t("coming_soon"),
        }}
      />

      <BillingLinkCard
        labels={{
          heading: t("billing_heading"),
          body: t("billing_body"),
          cta: t("billing_cta"),
        }}
      />

      <SignOutCard
        labels={{
          heading: t("signout_heading"),
          body: t("signout_body"),
          cta: t("signout_cta"),
        }}
      />
    </section>
  );
}

// ─── Language card · disabled "coming soon" (English only for now) ──────────

interface LanguageLabels {
  heading: string;
  subtitle: string;
  locale_label: string;
  locale_en: string;
  coming_soon: string;
}

function LanguageCard({ labels }: { labels: LanguageLabels }) {
  return (
    <section aria-labelledby="language-heading" style={cardStyle()}>
      <div style={cardHeadingRowStyle()}>
        <h2 id="language-heading" style={cardTitleStyle()}>
          {labels.heading}
        </h2>
        <ComingSoonPill label={labels.coming_soon} />
      </div>
      <p style={cardSubtitleStyle()}>{labels.subtitle}</p>
      <dl style={dlStyle()}>
        <Row label={labels.locale_label} value={labels.locale_en} />
      </dl>
    </section>
  );
}

// ─── Billing link card ─────────────────────────────────────────────────────

interface BillingLinkLabels {
  heading: string;
  body: string;
  cta: string;
}

function BillingLinkCard({ labels }: { labels: BillingLinkLabels }) {
  return (
    <section aria-labelledby="billing-link-heading" style={cardStyle()}>
      <h2 id="billing-link-heading" style={cardTitleStyle()}>
        {labels.heading}
      </h2>
      <p style={cardBodyTextStyle()}>{labels.body}</p>
      <Link href="/settings/billing" style={primaryButtonStyle()}>
        {labels.cta}
      </Link>
    </section>
  );
}

// ─── Sign-out card ─────────────────────────────────────────────────────────

interface SignOutLabels {
  heading: string;
  body: string;
  cta: string;
}

function SignOutCard({ labels }: { labels: SignOutLabels }) {
  return (
    <section aria-labelledby="signout-heading" style={cardStyle()}>
      <h2 id="signout-heading" style={cardTitleStyle()}>
        {labels.heading}
      </h2>
      <p style={cardBodyTextStyle()}>{labels.body}</p>
      <form action={signOutFromSettings}>
        <button type="submit" style={secondaryButtonStyle()}>
          {labels.cta}
        </button>
      </form>
    </section>
  );
}

// ─── Shared subcomponents + styles ─────────────────────────────────────────

function Row({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "8px 0",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <dt
        style={{
          margin: 0,
          color: "var(--color-text-3)",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          color: "var(--color-text)",
          fontSize: 15,
          wordBreak: "break-word",
        }}
      >
        {value}
      </dd>
    </div>
  );
}

function ComingSoonPill({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: "var(--color-bg-3)",
        color: "var(--color-text-2)",
        border: "1px solid var(--color-border)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function cardStyle(): React.CSSProperties {
  return {
    padding: "22px 22px 24px",
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 14,
    marginBottom: 16,
  };
}

function cardTitleStyle(): React.CSSProperties {
  return {
    margin: 0,
    fontFamily: "var(--font-serif)",
    fontSize: 19,
    letterSpacing: "-0.01em",
    color: "var(--color-text)",
  };
}

function cardSubtitleStyle(): React.CSSProperties {
  return {
    margin: "6px 0 0",
    color: "var(--color-text-2)",
    fontSize: 14,
    lineHeight: 1.5,
  };
}

function cardBodyTextStyle(): React.CSSProperties {
  return {
    margin: "8px 0 16px",
    color: "var(--color-text-2)",
    fontSize: 14,
    lineHeight: 1.5,
  };
}

function cardHeadingRowStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  };
}

function dlStyle(): React.CSSProperties {
  return {
    margin: "12px 0 0",
  };
}

function primaryButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    minWidth: 44,
    padding: "0 18px",
    background: "var(--color-coral)",
    color: "#fff",
    border: "1px solid var(--color-coral)",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 500,
    textDecoration: "none",
    cursor: "pointer",
  };
}

function secondaryButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    padding: "0 18px",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 500,
    textDecoration: "none",
    cursor: "pointer",
  };
}
