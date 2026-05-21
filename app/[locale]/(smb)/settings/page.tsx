/**
 * SMB settings · `/(smb)/settings` (locale-prefixed variants e.g.
 * `/es/configuracion`, `/fr/parametres` declared in `i18n/routing.ts`).
 *
 * Audience: Maria. Per `.claude/rules/ui-ux-smb.md`:
 *   - Warm, plain English. "Your settings" not "Account configuration".
 *   - One focal section per visual block. Cards stack on mobile.
 *   - Mobile-first (380px tap targets).
 *   - Generous whitespace, no dense tables.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2: SYNC default export + Suspense'd async body. Auth, DB,
 *     and i18n all live inside the boundary so the shell prerenders.
 *   - Pattern 1: `modules/smb-settings/queries.ts` has the NEXT_PHASE
 *     guard returning EMPTY so Vercel's build worker can prerender.
 *
 * Per `.claude/rules/security.md`:
 *   - `auth()` at the top of the inner body; `unauthorized()` interrupt
 *     for anon visitors (Next 16 auth interrupts).
 *
 * Per `.claude/rules/i18n.md`:
 *   - All copy in `messages/en.json` under `smb.settings.*`. ES + FR
 *     follow as separate i18n tasks per PLAN.md `i18n` tag.
 *
 * Per `.claude/rules/copy-voice.md`:
 *   - Maria's voice — no jargon, outcome-first, single CTA per card.
 *   - "Coming soon" callouts honest about what's not yet editable.
 *
 * Scope (E.6 v1 — what ships in this PR):
 *
 *   1. Identity card · viewer email + display name (read-only).
 *   2. Business profile card · name, address, category, website, phone,
 *      Google-claimed status — READ-ONLY. Source of truth is Google
 *      Business Profile; the C.8/C.9 cron pipeline syncs from Google →
 *      Mapsly. Editing here would just drift from Google.
 *   3. Brand voice & reply tone card · placeholder with "Coming soon"
 *      callout. Schema follow-up tagged in PLAN.md.
 *   4. Notifications card · placeholder with "Coming soon" callout.
 *   5. Language card · locale switcher writing the NEXT_LOCALE cookie.
 *      Functional (no schema needed — next-intl reads the cookie).
 *   6. Billing card · link to existing `/settings/billing` sub-route.
 *   7. Sign-out card · server action invoking NextAuth `signOut()`.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  getSmbSettingsData,
  signOutFromSettings,
  setPreferredLocale,
  type SmbSettingsData,
} from "@/modules/smb-settings";

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
      {[1, 2, 3, 4, 5].map((i) => (
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

      <IdentityCard
        data={data}
        labels={{
          heading: t("identity_heading"),
          email_label: t("identity_email_label"),
          name_label: t("identity_name_label"),
          name_unset: t("identity_name_unset"),
        }}
      />

      <BusinessProfileCard
        data={data}
        labels={{
          heading: t("business_heading"),
          subtitle: t("business_subtitle"),
          empty_heading: t("business_empty_heading"),
          empty_body: t("business_empty_body"),
          finish_setup: t("business_finish_setup"),
          name_label: t("business_name_label"),
          address_label: t("business_address_label"),
          category_label: t("business_category_label"),
          website_label: t("business_website_label"),
          phone_label: t("business_phone_label"),
          status_label: t("business_status_label"),
          status_claimed: t("business_status_claimed"),
          status_unclaimed: t("business_status_unclaimed"),
          source_note: t("business_source_note"),
          dash: t("dash"),
        }}
      />

      <BrandVoiceCard
        labels={{
          heading: t("brand_voice_heading"),
          subtitle: t("brand_voice_subtitle"),
          tone_label: t("brand_voice_tone_label"),
          tone_warm: t("brand_voice_tone_warm"),
          tone_professional: t("brand_voice_tone_professional"),
          tone_casual: t("brand_voice_tone_casual"),
          signature_label: t("brand_voice_signature_label"),
          coming_soon: t("coming_soon"),
        }}
      />

      <NotificationsCard
        labels={{
          heading: t("notifications_heading"),
          subtitle: t("notifications_subtitle"),
          digest_label: t("notifications_digest_label"),
          digest_desc: t("notifications_digest_desc"),
          urgent_label: t("notifications_urgent_label"),
          urgent_desc: t("notifications_urgent_desc"),
          weekly_label: t("notifications_weekly_label"),
          weekly_desc: t("notifications_weekly_desc"),
          coming_soon: t("coming_soon"),
        }}
      />

      <LanguageCard
        currentLocale={locale as Locale}
        labels={{
          heading: t("language_heading"),
          subtitle: t("language_subtitle"),
          locale_label: t("language_locale_label"),
          save_cta: t("language_save_cta"),
          locale_en: t("language_locale_en"),
          locale_es: t("language_locale_es"),
          locale_en_ca: t("language_locale_en_ca"),
          locale_fr: t("language_locale_fr"),
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

// ─── Identity card ─────────────────────────────────────────────────────────

interface IdentityLabels {
  heading: string;
  email_label: string;
  name_label: string;
  name_unset: string;
}

function IdentityCard({
  data,
  labels,
}: {
  data: SmbSettingsData;
  labels: IdentityLabels;
}) {
  return (
    <section aria-labelledby="identity-heading" style={cardStyle()}>
      <h2 id="identity-heading" style={cardTitleStyle()}>
        {labels.heading}
      </h2>
      <dl style={dlStyle()}>
        <Row label={labels.email_label} value={data.userEmail || "—"} />
        <Row
          label={labels.name_label}
          value={data.userName || labels.name_unset}
        />
      </dl>
    </section>
  );
}

// ─── Business profile card ─────────────────────────────────────────────────

interface BusinessProfileLabels {
  heading: string;
  subtitle: string;
  empty_heading: string;
  empty_body: string;
  finish_setup: string;
  name_label: string;
  address_label: string;
  category_label: string;
  website_label: string;
  phone_label: string;
  status_label: string;
  status_claimed: string;
  status_unclaimed: string;
  source_note: string;
  dash: string;
}

function BusinessProfileCard({
  data,
  labels,
}: {
  data: SmbSettingsData;
  labels: BusinessProfileLabels;
}) {
  if (data.ownedBusinessId === "") {
    return (
      <section aria-labelledby="business-heading" style={cardStyle()}>
        <h2 id="business-heading" style={cardTitleStyle()}>
          {labels.empty_heading}
        </h2>
        <p style={cardBodyTextStyle()}>{labels.empty_body}</p>
        <Link href="/onboarding" style={primaryButtonStyle()}>
          {labels.finish_setup}
        </Link>
      </section>
    );
  }

  const addressLine = [
    data.businessAddress,
    data.businessCity,
    data.businessProvince,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section aria-labelledby="business-heading" style={cardStyle()}>
      <h2 id="business-heading" style={cardTitleStyle()}>
        {labels.heading}
      </h2>
      <p style={cardSubtitleStyle()}>{labels.subtitle}</p>
      <dl style={dlStyle()}>
        <Row label={labels.name_label} value={data.businessName} />
        <Row label={labels.address_label} value={addressLine || labels.dash} />
        <Row
          label={labels.category_label}
          value={data.businessCategory || labels.dash}
        />
        <Row
          label={labels.website_label}
          value={
            data.businessWebsite ? (
              <a
                href={data.businessWebsite}
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle()}
              >
                {data.businessWebsite}
              </a>
            ) : (
              labels.dash
            )
          }
        />
        <Row
          label={labels.phone_label}
          value={data.businessPhone || labels.dash}
        />
        <Row
          label={labels.status_label}
          value={
            data.isClaimed ? (
              <StatusPill tone="success" label={labels.status_claimed} />
            ) : (
              <StatusPill tone="muted" label={labels.status_unclaimed} />
            )
          }
        />
      </dl>
      <p style={footnoteStyle()}>{labels.source_note}</p>
    </section>
  );
}

// ─── Brand voice card ──────────────────────────────────────────────────────

interface BrandVoiceLabels {
  heading: string;
  subtitle: string;
  tone_label: string;
  tone_warm: string;
  tone_professional: string;
  tone_casual: string;
  signature_label: string;
  coming_soon: string;
}

function BrandVoiceCard({ labels }: { labels: BrandVoiceLabels }) {
  return (
    <section aria-labelledby="brand-voice-heading" style={cardStyle()}>
      <div style={cardHeadingRowStyle()}>
        <h2 id="brand-voice-heading" style={cardTitleStyle()}>
          {labels.heading}
        </h2>
        <ComingSoonPill label={labels.coming_soon} />
      </div>
      <p style={cardSubtitleStyle()}>{labels.subtitle}</p>
      <fieldset
        disabled
        aria-disabled="true"
        style={{
          border: "none",
          padding: 0,
          margin: "12px 0 0",
          opacity: 0.55,
        }}
      >
        <label style={fieldLabelStyle()}>
          {labels.tone_label}
          <select disabled style={inputStyle()} defaultValue="warm">
            <option value="warm">{labels.tone_warm}</option>
            <option value="professional">{labels.tone_professional}</option>
            <option value="casual">{labels.tone_casual}</option>
          </select>
        </label>
        <label style={fieldLabelStyle()}>
          {labels.signature_label}
          <input disabled style={inputStyle()} placeholder="— Maria, Owner" />
        </label>
      </fieldset>
    </section>
  );
}

// ─── Notifications card ────────────────────────────────────────────────────

interface NotificationsLabels {
  heading: string;
  subtitle: string;
  digest_label: string;
  digest_desc: string;
  urgent_label: string;
  urgent_desc: string;
  weekly_label: string;
  weekly_desc: string;
  coming_soon: string;
}

function NotificationsCard({ labels }: { labels: NotificationsLabels }) {
  return (
    <section aria-labelledby="notifications-heading" style={cardStyle()}>
      <div style={cardHeadingRowStyle()}>
        <h2 id="notifications-heading" style={cardTitleStyle()}>
          {labels.heading}
        </h2>
        <ComingSoonPill label={labels.coming_soon} />
      </div>
      <p style={cardSubtitleStyle()}>{labels.subtitle}</p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "12px 0 0",
          opacity: 0.55,
        }}
        aria-disabled="true"
      >
        <NotificationItem
          label={labels.digest_label}
          desc={labels.digest_desc}
        />
        <NotificationItem
          label={labels.urgent_label}
          desc={labels.urgent_desc}
        />
        <NotificationItem
          label={labels.weekly_label}
          desc={labels.weekly_desc}
        />
      </ul>
    </section>
  );
}

function NotificationItem({ label, desc }: { label: string; desc: string }) {
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
        padding: "12px 0",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div>
        <div
          style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text)" }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--color-text-2)",
            marginTop: 2,
            lineHeight: 1.4,
          }}
        >
          {desc}
        </div>
      </div>
      <div
        aria-hidden
        style={{
          width: 36,
          height: 20,
          background: "var(--color-bg-3)",
          borderRadius: 999,
          flexShrink: 0,
          position: "relative",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            background: "var(--color-bg-2)",
            borderRadius: "50%",
            position: "absolute",
            top: 2,
            left: 2,
            border: "1px solid var(--color-border)",
          }}
        />
      </div>
    </li>
  );
}

// ─── Language card ─────────────────────────────────────────────────────────

interface LanguageLabels {
  heading: string;
  subtitle: string;
  locale_label: string;
  save_cta: string;
  locale_en: string;
  locale_es: string;
  locale_en_ca: string;
  locale_fr: string;
}

function LanguageCard({
  currentLocale,
  labels,
}: {
  currentLocale: Locale;
  labels: LanguageLabels;
}) {
  // Map next-intl routing locales to display names from i18n keys.
  const localeOptions: Array<{ value: Locale; label: string }> = [
    { value: "en", label: labels.locale_en },
    { value: "es", label: labels.locale_es },
    { value: "en-CA", label: labels.locale_en_ca },
    { value: "fr", label: labels.locale_fr },
  ];

  return (
    <section aria-labelledby="language-heading" style={cardStyle()}>
      <h2 id="language-heading" style={cardTitleStyle()}>
        {labels.heading}
      </h2>
      <p style={cardSubtitleStyle()}>{labels.subtitle}</p>
      <form action={setPreferredLocale} style={{ marginTop: 12 }}>
        <label style={fieldLabelStyle()}>
          {labels.locale_label}
          <select
            name="locale"
            defaultValue={currentLocale}
            style={inputStyle()}
            aria-label={labels.locale_label}
          >
            {localeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          style={{ ...primaryButtonStyle(), marginTop: 12 }}
        >
          {labels.save_cta}
        </button>
      </form>
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

function StatusPill({
  tone,
  label,
}: {
  tone: "success" | "muted";
  label: string;
}) {
  const palette =
    tone === "success"
      ? {
          bg: "var(--color-success-bg, rgba(16, 156, 102, 0.08))",
          fg: "var(--color-success)",
          border: "var(--color-success)",
        }
      : {
          bg: "var(--color-bg-3)",
          fg: "var(--color-text-2)",
          border: "var(--color-border)",
        };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: palette.fg,
        }}
      />
      {label}
    </span>
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

function fieldLabelStyle(): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 12,
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--color-text-3)",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    height: 44,
    padding: "0 12px",
    fontSize: 15,
    fontFamily: "var(--font-sans)",
    textTransform: "none",
    letterSpacing: 0,
    color: "var(--color-text)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
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

function linkStyle(): React.CSSProperties {
  return {
    color: "var(--color-coral)",
    textDecoration: "none",
  };
}

function footnoteStyle(): React.CSSProperties {
  return {
    margin: "12px 0 0",
    color: "var(--color-text-3)",
    fontSize: 12,
    lineHeight: 1.5,
  };
}
