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
  AgencyMemberRoleValue,
  AgencyPlanValue,
  AgencySettingsData,
} from "@/modules/agency-settings/types";
import { SettingsSection } from "@/modules/agency-settings/components/SettingsSection";

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
    redirect({ href: "/dashboard", locale });
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

      <ProfileCard t={t} data={data} canEdit={canEditProfile} />
      <PlanCard t={t} plan={data.agency.plan} />
      <TeamCard t={t} members={data.members} />
      <LocaleCard t={t} currentLocale={locale as Locale} />
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

function TeamCard({
  t,
  members,
}: {
  t: (key: string, vars?: Record<string, string | number>) => string;
  members: AgencySettingsData["members"];
}) {
  return (
    <SettingsSection
      headingId="agency-settings-team-heading"
      heading={t("sections.team.heading")}
    >
      {members.length === 0 ? (
        <p style={styles.emptyText}>—</p>
      ) : (
        <ul style={styles.memberList}>
          {members.map((m) => (
            <li key={m.id} style={styles.memberRow}>
              <span aria-hidden style={styles.memberAvatar}>
                {(m.userName ?? m.userEmail ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span style={styles.memberBody}>
                <span style={styles.memberName}>
                  {m.userName ?? m.userEmail}
                </span>
                <span style={styles.memberEmail}>{m.userEmail}</span>
              </span>
              <RolePill role={m.role} t={t} />
            </li>
          ))}
        </ul>
      )}
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

function RolePill({
  role,
  t,
}: {
  role: AgencyMemberRoleValue;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const roleStyle: CSSProperties =
    role === "OWNER"
      ? {
          background: "var(--color-agency-indigo, #5b3df5)",
          color: "#fff",
          borderColor: "transparent",
        }
      : role === "ADMIN"
        ? {
            background: "#475569",
            color: "#fff",
            borderColor: "transparent",
          }
        : {
            background: "var(--color-bg)",
            color: "var(--color-text-2)",
            borderColor: "var(--color-border)",
          };
  const label =
    role === "OWNER"
      ? t("sections.team.role.owner")
      : role === "ADMIN"
        ? t("sections.team.role.admin")
        : t("sections.team.role.staff");
  return <span style={{ ...styles.rolePill, ...roleStyle }}>{label}</span>;
}

function planLiteral(
  plan: AgencyPlanValue,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
};
