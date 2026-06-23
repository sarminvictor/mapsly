/**
 * Agency onboarding · `/(agency)/setup` (locale variants
 * `/es/configurar`, `/fr/configurer`).
 *
 * Reworked for the demand-driven portal: a single lean profile step.
 * Tom sets his agency's default metro + the categories he serves, then
 * lands on `/discover` (the new demand-driven entry point). The old
 * 3-step wizard (template picking + lead preview that seeded a List)
 * was removed with the supply-driven lists portal.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 1 — `getAgencyOnboardingData` short-circuits to EMPTY for
 *     build phase + Prisma errors.
 *   - Pattern 2 — default export is SYNC; async body Suspense'd.
 *   - Pattern 4 — no `t.rich()` render props.
 *   - Pattern 5 — no `export const dynamic`.
 *
 * Audience: Tom (agency). Voice: tool-y, dense, jargon-OK, indigo
 * accents per `.claude/rules/ui-ux-agency.md`.
 */

import { Suspense, type CSSProperties, type ReactNode } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";

import { updateAgencyProfile } from "@/modules/agency-onboarding/actions";
import { getAgencyOnboardingData } from "@/modules/agency-onboarding/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "agency.onboarding.meta",
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
export default function AgencyOnboardingPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<OnboardingSkeleton />}>
      <OnboardingBody params={params} />
    </Suspense>
  );
}

function OnboardingSkeleton() {
  return (
    <section aria-hidden style={styles.shell}>
      <div
        style={{ ...styles.skel, height: 18, width: 100, marginBottom: 12 }}
      />
      <div style={{ ...styles.skel, height: 240 }} />
    </section>
  );
}

async function OnboardingBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
    return null;
  }

  const t = await getTranslations("agency.onboarding");
  const data = await getAgencyOnboardingData(session.user.id);

  // Stray SMB user (no AgencyMember) bounces to SMB dashboard.
  if (data.agencyId === "") {
    redirect({ href: "/home", locale });
    return null;
  }

  return (
    <section style={styles.shell}>
      <p style={styles.eyebrow}>{t("eyebrow")}</p>

      <div style={styles.card}>
        <h1 style={styles.title}>{t("title_step1")}</h1>
        <p style={styles.lead}>{t("intro_step1")}</p>

        <form action={updateAgencyProfile} style={styles.form}>
          <FieldLabel htmlFor="agency-onboarding-metro">
            {t("metro_label")}
          </FieldLabel>
          <input
            id="agency-onboarding-metro"
            name="defaultMetro"
            type="text"
            required
            maxLength={64}
            placeholder={t("metro_placeholder")}
            defaultValue={data.defaultMetro}
            autoComplete="address-level2"
            style={styles.input}
          />
          <p style={styles.helpText}>{t("metro_help")}</p>

          <FieldLabel htmlFor="agency-onboarding-categories">
            {t("categories_label")}
          </FieldLabel>
          <input
            id="agency-onboarding-categories"
            name="categoriesServed"
            type="text"
            maxLength={512}
            placeholder={t("categories_placeholder")}
            defaultValue={data.categoriesServed}
            style={styles.input}
          />
          <p style={styles.helpText}>{t("categories_help")}</p>

          <button type="submit" style={styles.primaryButton}>
            {t("save_continue")}
          </button>
        </form>
      </div>

      <div style={styles.footer}>
        <Link href="/discover" style={styles.textLink}>
          {t("skip_to_discover")}
        </Link>
      </div>
    </section>
  );
}

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

/* ------------------------------------------------------------------ */
/* Styles · agency palette (cool gray + indigo accent)                */
/* ------------------------------------------------------------------ */

const styles: Record<string, CSSProperties> = {
  shell: { maxWidth: 760, margin: "0 auto", padding: "32px 20px 64px" },
  skel: { background: "var(--color-bg-2)", borderRadius: 14 },
  eyebrow: {
    margin: "0 0 8px",
    fontSize: 13,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--color-agency-indigo, #5b3df5)",
  },
  card: {
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 16,
    padding: "28px 24px",
    marginBottom: 20,
  },
  title: {
    fontFamily: "var(--font-serif, inherit)",
    fontSize: "clamp(22px, 3.4vw, 28px)",
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
    margin: 0,
    color: "var(--color-text)",
  },
  lead: {
    margin: "10px 0 0",
    fontSize: 15,
    lineHeight: 1.55,
    color: "var(--color-text-2)",
  },
  helpText: {
    margin: "4px 0 0",
    fontSize: 13,
    color: "var(--color-text-2)",
  },
  form: { marginTop: 20, display: "flex", flexDirection: "column", gap: 8 },
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
  textLink: {
    fontSize: 14,
    color: "var(--color-text-2)",
    textDecoration: "underline",
    padding: "12px 4px",
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
  },
};
