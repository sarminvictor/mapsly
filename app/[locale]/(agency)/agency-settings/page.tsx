/**
 * Agency settings · `/(agency)/settings` (locale variants
 * `/es/configuracion`, `/fr/parametres`).
 *
 * F.9 v1 scope — read-mostly settings for Tom:
 *
 *   1. Profile · agency name, default metro, categories served. Editable
 *      via server action · OWNER or ADMIN only · STAFF sees the values
 *      but no Save button.
 *   2. Plan · current AgencyPlan literal (display-only). Links to the
 *      billing checkout flow (G.4 owns the actual checkout UI; this is
 *      a placeholder `/api/billing/checkout` link until that ships).
 *   3. Team · roster of `AgencyMember` rows with role pill. Read-only.
 *      Invite / remove are explicit follow-ups (not in this PR).
 *   4. Locale · `<select>` posting to `setLocalePreference` so Tom can
 *      switch the UI language. Writes the `NEXT_LOCALE` cookie.
 *   5. Sign out · link to `/api/auth/signout` (NextAuth default route).
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - Pattern 1 — `getAgencySettings` short-circuits to EMPTY in the
 *     build phase + Prisma errors.
 *   - Pattern 2 — default export is SYNC; async body Suspense'd. Auth,
 *     cookies, and DB all live inside the boundary.
 *   - Pattern 4 — no `t.rich()` render props · plain `t(key)` only.
 *   - Pattern 5 — no `export const dynamic` · Suspense is the opt-out.
 *
 * Audience: Tom · cool gray + indigo, dense, tool-y per
 * `.claude/rules/ui-ux-agency.md`. Tom voice per
 * `.claude/rules/copy-voice.md` § Agency.
 */

import { Suspense, type CSSProperties, type ReactNode } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

import {
  signOutFromAgencySettings,
  updateAgencyProfile,
  setLocalePreference,
} from "@/modules/agency-settings/actions";
import { getAgencySettings } from "@/modules/agency-settings/queries";
import type {
  AgencyPlanValue,
  AgencySettingsData,
} from "@/modules/agency-settings/types";
import { SettingsSection } from "@/modules/agency-settings/components/SettingsSection";
import { TeamManagePanel } from "@/modules/agency-settings/components/TeamManagePanel";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "agency.settings.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

/** Sync shell · Pattern 2. */
export default function AgencySettingsPage({
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
    <section aria-hidden style={styles.shell}>
      <div
        style={{ ...styles.skel, height: 18, width: 120, marginBottom: 8 }}
      />
      <div
        style={{ ...styles.skel, height: 36, width: 280, marginBottom: 24 }}
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{ ...styles.skel, height: 140, marginBottom: 16 }}
        />
      ))}
    </section>
  );
}

async function SettingsBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
    return null;
  }

  const t = await getTranslations("agency.settings");
  const data = await getAgencySettings(session.user.id);

  // Stray SMB user · no AgencyMember row · bounce to the SMB dashboard.
  if (data.agency.id === "") {
    redirect({ href: "/home", locale });
    return null;
  }

  const canEditProfile =
    data.membership.role === "OWNER" || data.membership.role === "ADMIN";

  return (
    <section aria-labelledby="agency-settings-heading" style={styles.shell}>
      <header style={{ marginBottom: 24 }}>
        <h1 id="agency-settings-heading" style={styles.heading}>
          {t("heading")}
        </h1>
        <p style={styles.subheading}>{t("subheading")}</p>
      </header>

      <StickyNav t={t} />

      <ProfileCard t={t} data={data} canEdit={canEditProfile} />
      <PlanCard t={t} plan={data.agency.plan} />
      <TeamCard t={t} data={data} selfUserId={session.user.id} />
      <LocaleCard t={t} currentLocale={locale as Locale} />
      <NotificationsCard t={t} />
      <PrivacyCard t={t} />
      <DangerZoneCard t={t} />
      <SignOutCard t={t} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                           */
/* ------------------------------------------------------------------ */

function ProfileCard({
  t,
  data,
  canEdit,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  data: AgencySettingsData;
  canEdit: boolean;
}) {
  return (
    <SettingsSection
      headingId="agency-settings-profile-heading"
      heading={t("sections.profile.heading")}
    >
      <form action={updateAgencyProfile} style={styles.form}>
        <FieldLabel htmlFor="agency-settings-name">
          {t("sections.profile.fields.name")}
        </FieldLabel>
        <input
          id="agency-settings-name"
          name="name"
          type="text"
          required
          maxLength={80}
          defaultValue={data.agency.name}
          disabled={!canEdit}
          aria-disabled={!canEdit || undefined}
          style={styles.input}
        />
        <p style={styles.helpText}>{t("sections.profile.helpName")}</p>

        <FieldLabel htmlFor="agency-settings-metro">
          {t("sections.profile.fields.defaultMetro")}
        </FieldLabel>
        <input
          id="agency-settings-metro"
          name="defaultMetro"
          type="text"
          maxLength={64}
          defaultValue={data.agency.defaultMetro ?? ""}
          disabled={!canEdit}
          aria-disabled={!canEdit || undefined}
          style={styles.input}
        />
        <p style={styles.helpText}>{t("sections.profile.helpMetro")}</p>

        <FieldLabel htmlFor="agency-settings-categories">
          {t("sections.profile.fields.categoriesServed")}
        </FieldLabel>
        <input
          id="agency-settings-categories"
          name="categoriesServed"
          type="text"
          maxLength={512}
          defaultValue={data.agency.categoriesServed.join(", ")}
          disabled={!canEdit}
          aria-disabled={!canEdit || undefined}
          style={styles.input}
        />
        <p style={styles.helpText}>{t("sections.profile.helpCategories")}</p>

        {/* WP7-4 · compliance-footer address. Email touchpoints won't generate
            without it (CAN-SPAM/CASL both require a physical address); the
            amber callout is the blocking "add your address to send" state. */}
        {!data.agency.mailingAddress ? (
          <p style={styles.warnCallout} role="status">
            {t("sections.profile.mailingAddressMissing")}
          </p>
        ) : null}
        <FieldLabel htmlFor="agency-settings-mailing">
          {t("sections.profile.fields.mailingAddress")}
        </FieldLabel>
        <input
          id="agency-settings-mailing"
          name="mailingAddress"
          type="text"
          maxLength={300}
          defaultValue={data.agency.mailingAddress ?? ""}
          placeholder="123 Main St, Suite 4, Toronto, ON M5V 2T6"
          disabled={!canEdit}
          aria-disabled={!canEdit || undefined}
          aria-invalid={!data.agency.mailingAddress || undefined}
          style={styles.input}
        />
        <p style={styles.helpText}>
          {t("sections.profile.helpMailingAddress")}
        </p>

        {canEdit ? (
          <button type="submit" style={styles.primaryButton}>
            {t("sections.profile.save")}
          </button>
        ) : null}
      </form>
    </SettingsSection>
  );
}

function PlanCard({
  t,
  plan,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  plan: AgencyPlanValue;
}) {
  const planLabel = planLiteral(plan, t);
  return (
    <SettingsSection
      headingId="agency-settings-plan-heading"
      heading={t("sections.plan.heading")}
      trailing={
        <span style={styles.planPill}>
          <span style={styles.planPillDot} aria-hidden />
          {planLabel}
        </span>
      }
    >
      <p style={styles.planRow}>
        <span style={styles.planRowLabel}>
          {t("sections.plan.currentPlan")}
        </span>
        <span style={styles.planRowValue}>{planLabel}</span>
      </p>
      <Link href="/settings/billing" style={styles.linkButton}>
        {t("sections.plan.upgrade")}
      </Link>
    </SettingsSection>
  );
}

/**
 * Team · WP5-8 makes this FUNCTIONAL: roster + role pills, remove member
 * (OWNER only, never self), pending invites with revoke, and the invite form
 * gated by role + seat cap. The interactive body is the TeamManagePanel
 * client component (plain serialized props — Pattern 4).
 */
function TeamCard({
  t,
  data,
  selfUserId,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  data: AgencySettingsData;
  selfUserId: string;
}) {
  const role = data.membership.role;
  return (
    <SettingsSection
      headingId="agency-settings-team-heading"
      heading={t("sections.team.heading")}
    >
      <TeamManagePanel
        members={data.members}
        invites={data.invites}
        seats={data.seats}
        canManage={role === "OWNER" || role === "ADMIN"}
        isOwner={role === "OWNER"}
        selfUserId={selfUserId}
      />
    </SettingsSection>
  );
}

function LocaleCard({
  t,
  currentLocale,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  currentLocale: Locale;
}) {
  const localeOptions: Array<{ value: Locale; label: string }> = [
    { value: "en", label: "English (US)" },
    { value: "es", label: "Español" },
    { value: "en-CA", label: "English (Canada)" },
    { value: "fr", label: "Français (Canada)" },
  ];
  return (
    <SettingsSection
      headingId="agency-settings-locale-heading"
      heading={t("sections.locale.heading")}
      subtitle={t("sections.locale.help")}
    >
      <form action={setLocalePreference} style={styles.localeForm}>
        <select
          name="locale"
          defaultValue={currentLocale}
          aria-label={t("sections.locale.heading")}
          style={styles.select}
        >
          {localeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button type="submit" style={styles.primaryButton}>
          {t("sections.locale.save")}
        </button>
      </form>
    </SettingsSection>
  );
}

function SignOutCard({
  t,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <SettingsSection
      headingId="agency-settings-signout-heading"
      heading={t("sections.signOut.heading")}
    >
      <form action={signOutFromAgencySettings}>
        <button type="submit" style={styles.dangerLink}>
          {t("sections.signOut.cta")}
        </button>
      </form>
    </SettingsSection>
  );
}

/**
 * StickyNav · in-page anchor strip rendered above all section cards.
 *
 * Tom uses this to jump between settings sections instead of scrolling.
 * Server-component-safe — just anchor links + a sticky position from
 * inline styles. The page's `padding-top: 32px` interacts with the
 * sticky offset so the focused section heading lands cleanly below
 * the nav bar.
 *
 * Per `.claude/rules/accessibility.md` the nav uses `<nav aria-label>`
 * so screen-readers announce the region; the anchored sections each
 * have `scroll-margin-top` applied via inline style on `SettingsSection`
 * (handled by the existing component).
 */
function StickyNav({
  t,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const items: Array<{ id: string; label: string }> = [
    {
      id: "agency-settings-profile-heading",
      label: t("sections.profile.heading"),
    },
    { id: "agency-settings-plan-heading", label: t("sections.plan.heading") },
    { id: "agency-settings-team-heading", label: t("sections.team.heading") },
    {
      id: "agency-settings-locale-heading",
      label: t("sections.locale.heading"),
    },
    {
      id: "agency-settings-notifications-heading",
      label: t("sections.notifications.heading"),
    },
    {
      id: "agency-settings-privacy-heading",
      label: t("sections.privacy.heading"),
    },
    {
      id: "agency-settings-danger-heading",
      label: t("sections.danger.heading"),
    },
  ];
  return (
    <nav
      aria-label={t("nav.aria")}
      data-testid="agency-settings-sticky-nav"
      style={styles.stickyNav}
    >
      <ul style={styles.stickyNavList}>
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} style={styles.stickyNavLink}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * NotificationsCard · informational summary of which emails Tom's
 * agency receives. v1 surfaces the canonical email types (no DB-backed
 * preferences yet; that's a follow-up that needs a
 * NotificationPreferences model + per-user toggles).
 */
function NotificationsCard({
  t,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const items = [
    {
      title: t("sections.notifications.items.refresh.title"),
      body: t("sections.notifications.items.refresh.body"),
    },
    {
      title: t("sections.notifications.items.weekly.title"),
      body: t("sections.notifications.items.weekly.body"),
    },
    {
      title: t("sections.notifications.items.billing.title"),
      body: t("sections.notifications.items.billing.body"),
    },
  ];
  return (
    <SettingsSection
      headingId="agency-settings-notifications-heading"
      heading={t("sections.notifications.heading")}
      subtitle={t("sections.notifications.subtitle")}
    >
      <ul style={styles.notificationList}>
        {items.map((item) => (
          <li key={item.title} style={styles.notificationRow}>
            <span style={styles.notificationTitle}>{item.title}</span>
            <span style={styles.notificationBody}>{item.body}</span>
          </li>
        ))}
      </ul>
      <p style={styles.helpText}>{t("sections.notifications.footer")}</p>
    </SettingsSection>
  );
}

/**
 * PrivacyCard · links out to the public privacy + terms pages plus a
 * "Request data export" mailto. The data-export flow runs through
 * humans for v1 — when Phase H lands the dashboard, this will switch
 * to a server action that drops a JSON archive into Vercel Blob.
 */
function PrivacyCard({
  t,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <SettingsSection
      headingId="agency-settings-privacy-heading"
      heading={t("sections.privacy.heading")}
      subtitle={t("sections.privacy.subtitle")}
    >
      <ul style={styles.linkList}>
        <li>
          <Link href={{ pathname: "/privacy" }} style={styles.linkButton}>
            {t("sections.privacy.privacyPolicy")}
          </Link>
        </li>
        <li>
          <Link href={{ pathname: "/terms" }} style={styles.linkButton}>
            {t("sections.privacy.terms")}
          </Link>
        </li>
        <li>
          <a
            href="mailto:support@mapsly.ai?subject=Data%20export%20request"
            style={styles.linkButton}
            data-testid="agency-settings-export-request"
          >
            {t("sections.privacy.requestExport")}
          </a>
        </li>
      </ul>
      <p style={styles.helpText}>{t("sections.privacy.exportNote")}</p>
    </SettingsSection>
  );
}

/**
 * DangerZoneCard · account-deletion contact + visual warning.
 *
 * v1 keeps the action out-of-band (mailto:support@mapsly.ai) so we
 * never accidentally delete an active billing subscription. A
 * proper cascading delete server action with billing teardown is a
 * follow-up that needs careful integration with Stripe subscription
 * cancellation + Vercel Blob report cleanup.
 */
function DangerZoneCard({
  t,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <SettingsSection
      headingId="agency-settings-danger-heading"
      heading={t("sections.danger.heading")}
      subtitle={t("sections.danger.subtitle")}
    >
      <div style={styles.dangerCallout}>
        <p style={styles.dangerCalloutBody}>{t("sections.danger.body")}</p>
        <a
          href="mailto:support@mapsly.ai?subject=Delete%20agency%20account"
          style={styles.dangerLink}
          data-testid="agency-settings-delete-account"
        >
          {t("sections.danger.cta")}
        </a>
      </div>
    </SettingsSection>
  );
}

/* ------------------------------------------------------------------ */
/* Atoms                                                              */
/* ------------------------------------------------------------------ */

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} style={styles.fieldLabel}>
      {children}
    </label>
  );
}

function planLiteral(
  plan: AgencyPlanValue,

  _t: (key: string) => string,
): string {
  // Values come from messages/<locale>.json so they're translatable.
  if (plan === "SOLO") return "Solo · $49/mo";
  if (plan === "GROWTH") return "Growth · $99/mo";
  if (plan === "AGENCY_PRO") return "Pro · $249/mo";
  if (plan === "BOUTIQUE") return "Boutique · $499/mo";
  // Fallback covers any future enum value before this code's redeploy.
  return plan as string;
}

/* ------------------------------------------------------------------ */
/* Styles · agency palette (cool gray + indigo)                       */
/* ------------------------------------------------------------------ */

const styles: Record<string, CSSProperties> = {
  shell: { maxWidth: 760, margin: "0 auto", padding: "32px 20px 64px" },
  skel: { background: "var(--color-bg-2)", borderRadius: 14 },
  heading: {
    margin: "6px 0 0",
    fontFamily: "var(--font-serif, inherit)",
    fontSize: "clamp(24px, 3.6vw, 30px)",
    lineHeight: 1.15,
    letterSpacing: "-0.01em",
    color: "var(--color-text)",
  },
  subheading: {
    margin: "8px 0 0",
    fontSize: 15,
    lineHeight: 1.5,
    color: "var(--color-text-2)",
  },
  form: { display: "flex", flexDirection: "column", gap: 4 },
  fieldLabel: {
    display: "block",
    fontSize: 14,
    fontWeight: 500,
    marginTop: 12,
    marginBottom: 4,
    color: "var(--color-text)",
  },
  input: {
    width: "100%",
    padding: "11px 14px",
    fontSize: 15,
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    minHeight: 44,
    boxSizing: "border-box",
  },
  select: {
    padding: "11px 14px",
    fontSize: 15,
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    minHeight: 44,
    minWidth: 220,
    boxSizing: "border-box",
  },
  helpText: {
    margin: "4px 0 0",
    fontSize: 13,
    color: "var(--color-text-2)",
  },
  primaryButton: {
    marginTop: 16,
    padding: "12px 22px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 10,
    border: "none",
    background: "var(--color-agency-indigo, #5b3df5)",
    color: "#fff",
    cursor: "pointer",
    minHeight: 44,
    alignSelf: "flex-start",
  },
  linkButton: {
    display: "inline-flex",
    alignItems: "center",
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    textDecoration: "none",
    minHeight: 44,
    alignSelf: "flex-start",
  },
  dangerLink: {
    display: "inline-flex",
    alignItems: "center",
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "#b91c1c",
    textDecoration: "none",
    minHeight: 44,
    alignSelf: "flex-start",
  },
  localeForm: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 12,
  },
  planRow: {
    margin: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 14,
    color: "var(--color-text)",
  },
  planRowLabel: { color: "var(--color-text-2)" },
  planRowValue: {
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: 13.5,
  },
  planPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    fontSize: 12.5,
    fontWeight: 600,
    borderRadius: 999,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
  },
  planPillDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--color-agency-indigo, #5b3df5)",
  },
  memberList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  memberRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
  },
  memberAvatar: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "var(--color-bg-2)",
    color: "var(--color-text-2)",
    fontSize: 13,
    fontWeight: 600,
    flex: "0 0 auto",
  },
  memberBody: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: "1 1 auto",
    minWidth: 0,
  },
  memberName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  memberEmail: {
    fontSize: 12.5,
    color: "var(--color-text-2)",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rolePill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    borderRadius: 999,
    border: "1px solid",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    flex: "0 0 auto",
  },
  emptyText: {
    margin: 0,
    fontSize: 14,
    color: "var(--color-text-2)",
  },

  /* sticky in-page nav · indigo-accent strip above sections */
  stickyNav: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    margin: "0 0 20px",
    padding: "10px 0",
    background: "var(--color-bg)",
    borderBottom: "1px solid var(--color-border)",
    backdropFilter: "saturate(180%) blur(8px)",
    WebkitBackdropFilter: "saturate(180%) blur(8px)",
  },
  stickyNavList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  stickyNavLink: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--color-text-2)",
    textDecoration: "none",
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-2)",
    whiteSpace: "nowrap",
  },

  /* notifications · informational list */
  notificationList: {
    listStyle: "none",
    padding: 0,
    margin: "0 0 12px",
    display: "grid",
    gap: 10,
  },
  notificationRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
  },
  notificationTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--color-text)",
  },
  notificationBody: {
    fontSize: 12.5,
    color: "var(--color-text-2)",
    lineHeight: 1.5,
  },

  /* privacy · vertical link list */
  linkList: {
    listStyle: "none",
    padding: 0,
    margin: "0 0 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },

  /* danger zone · red-tinted callout */
  dangerCallout: {
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid rgba(181,61,71,.20)",
    background: "rgba(181,61,71,.04)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  dangerCalloutBody: {
    margin: 0,
    fontSize: 13.5,
    color: "var(--color-text)",
    lineHeight: 1.5,
  },
  /* WP7-4 · amber "add your address to send" blocking state. */
  warnCallout: {
    margin: "6px 0 4px",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid rgba(180,120,10,.28)",
    background: "rgba(200,140,20,.07)",
    fontSize: 13.5,
    color: "var(--color-text)",
    lineHeight: 1.5,
  },
};
