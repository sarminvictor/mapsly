/**
 * Agency onboarding · `/(agency)/setup` (locale variants
 * `/es/configurar`, `/fr/configurer`). Three-step wizard for Tom:
 *
 *   1. Agency profile — defaultMetro + categoriesServed.
 *   2. Pick first service template — seeds a List row.
 *   3. Preview first 50 free leads — drop into /lists at the end.
 *
 * Skips allowed on every step via a "Skip for now" Link.
 *
 * Step state lives in the URL (`?step=1..3`) so the route stays
 * streamable under `cacheComponents`, refreshing keeps state, and
 * browser back navigates the wizard.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 1 — `getAgencyOnboardingData` short-circuits to EMPTY for
 *     build phase + Prisma errors.
 *   - Pattern 2 — default export is SYNC; async body Suspense'd.
 *   - Pattern 3 — `searchParams` awaited INSIDE the inner component.
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

import {
  chooseServiceTemplate,
  finishAgencyOnboarding,
  updateAgencyProfile,
} from "@/modules/agency-onboarding/actions";
import { getAgencyOnboardingData } from "@/modules/agency-onboarding/queries";
import {
  parseStep,
  TOTAL_STEPS,
  type AgencyOnboardingData,
  type OnboardingStep,
} from "@/modules/agency-onboarding/types";
import { StepIndicator } from "@/modules/agency-onboarding/components/StepIndicator";
import { SERVICE_TEMPLATES } from "@/modules/agency-portal/lists/service-templates";

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
interface PageSearch {
  step?: string | string[];
}

/** Sync shell · Pattern 2 + Pattern 3. */
export default function AgencyOnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearch>;
}) {
  return (
    <Suspense fallback={<OnboardingSkeleton />}>
      <OnboardingBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function OnboardingSkeleton() {
  return (
    <section aria-hidden style={styles.shell}>
      <div
        style={{ ...styles.skel, height: 18, width: 100, marginBottom: 12 }}
      />
      <div
        style={{
          ...styles.skel,
          height: 44,
          marginBottom: 32,
          borderRadius: 999,
        }}
      />
      <div style={{ ...styles.skel, height: 240 }} />
    </section>
  );
}

async function OnboardingBody({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearch>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
    return null;
  }

  const { step: stepParam } = await searchParams;
  const step = parseStep(stepParam);

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

      <StepIndicator
        current={step}
        labels={{
          step1: t("step1_label"),
          step2: t("step2_label"),
          step3: t("step3_label"),
          countLabel: t("step_label", { current: step, total: TOTAL_STEPS }),
        }}
      />

      <div style={styles.card}>
        <StepContent step={step} t={t} data={data} />
      </div>

      <Footer step={step} t={t} />
    </section>
  );
}

function StepContent({
  step,
  t,
  data,
}: {
  step: OnboardingStep;
  t: (key: string, vars?: Record<string, string | number>) => string;
  data: AgencyOnboardingData;
}) {
  if (step === 1) return <ProfileStep t={t} data={data} />;
  if (step === 2) return <TemplateStep t={t} data={data} />;
  return <PreviewStep t={t} data={data} />;
}

/* ------------------------------------------------------------------ */
/* Step bodies                                                        */
/* ------------------------------------------------------------------ */

function ProfileStep({
  t,
  data,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  data: AgencyOnboardingData;
}) {
  return (
    <>
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
          style={styles.input}
        />
        <p style={styles.helpText}>{t("categories_help")}</p>

        <button type="submit" style={styles.primaryButton}>
          {t("save_continue")}
        </button>
      </form>
    </>
  );
}

function TemplateStep({
  t,
  data,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  data: AgencyOnboardingData;
}) {
  const used = new Set(data.serviceTemplatesUsed);
  return (
    <>
      <h1 style={styles.title}>{t("title_step2")}</h1>
      <p style={styles.lead}>{t("intro_step2")}</p>
      <form action={chooseServiceTemplate} style={styles.templateGrid}>
        {SERVICE_TEMPLATES.map((tpl) => {
          const disabled = used.has(tpl.key);
          return (
            <button
              key={tpl.key}
              type="submit"
              name="templateKey"
              value={tpl.key}
              disabled={disabled}
              aria-disabled={disabled || undefined}
              style={{
                ...styles.templateCard,
                ...(disabled ? styles.templateCardDisabled : null),
              }}
            >
              <span aria-hidden style={styles.templateGlyph}>
                {tpl.glyph}
              </span>
              <span style={styles.templateBody}>
                <span style={styles.templateLabel}>
                  {t(`templates.${tpl.key}.label`)}
                </span>
                <span style={styles.templateMeta}>
                  {t(`templates.${tpl.key}.meta`)}
                </span>
              </span>
              {disabled && (
                <span style={styles.templateBadge}>{t("already_added")}</span>
              )}
            </button>
          );
        })}
      </form>
    </>
  );
}

function PreviewStep({
  t,
  data,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  data: AgencyOnboardingData;
}) {
  const visible = data.sampleLeads.slice(0, 20);
  return (
    <>
      <h1 style={styles.title}>{t("title_step3")}</h1>
      <p style={styles.lead}>{t("intro_step3")}</p>
      {visible.length === 0 ? (
        <p style={{ ...styles.lead, marginTop: 20 }}>{t("preview_empty")}</p>
      ) : (
        <ul style={styles.previewList}>
          {visible.map((lead) => (
            <li key={lead.id} style={styles.previewRow}>
              <span aria-hidden style={styles.previewAvatar}>
                {lead.name.slice(0, 1).toUpperCase()}
              </span>
              <span style={styles.previewBody}>
                <span style={styles.previewName}>{lead.name}</span>
                <span style={styles.previewMeta}>
                  {[lead.city, lead.category].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span style={styles.previewRating}>
                {lead.rating.toFixed(1)}{" "}
                <span aria-hidden style={styles.previewStar}>
                  ★
                </span>{" "}
                <span style={styles.previewReviewCount}>
                  ({lead.reviewCount})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.moreAvailable > 0 && (
        <p style={{ ...styles.helpText, marginTop: 12 }}>
          {t("preview_more", { count: data.moreAvailable })}
        </p>
      )}
    </>
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
/* Footer · step navigation                                           */
/* ------------------------------------------------------------------ */

function Footer({
  step,
  t,
}: {
  step: OnboardingStep;
  t: (k: string) => string;
}) {
  const nextStep = (step + 1) as OnboardingStep;
  const isFinal = step === TOTAL_STEPS;

  return (
    <div style={styles.footer}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {!isFinal && (
          <Link
            href={{ pathname: "/setup", query: { step: nextStep } }}
            style={styles.textLink}
          >
            {t("skip_for_now")}
          </Link>
        )}
        {isFinal && (
          <Link href="/lists" style={styles.textLink}>
            {t("skip_to_lists")}
          </Link>
        )}
      </div>
      {isFinal && (
        <form action={finishAgencyOnboarding}>
          <button type="submit" style={styles.primaryButton}>
            {t("see_my_lists")}
          </button>
        </form>
      )}
    </div>
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
    justifyContent: "space-between",
    gap: 12,
  },
  templateGrid: {
    marginTop: 20,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 12,
  },
  templateCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 14px",
    borderRadius: 12,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    cursor: "pointer",
    textAlign: "left",
    minHeight: 76,
    position: "relative",
  },
  templateCardDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
    background: "var(--color-bg-2)",
  },
  templateGlyph: {
    fontSize: 22,
    lineHeight: 1,
    flex: "0 0 auto",
  },
  templateBody: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  },
  templateLabel: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--color-text)",
  },
  templateMeta: {
    fontSize: 12.5,
    lineHeight: 1.4,
    color: "var(--color-text-2)",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
  },
  templateBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    background: "var(--color-bg-2)",
    color: "var(--color-text-2)",
    border: "1px solid var(--color-border)",
  },
  previewList: {
    listStyle: "none",
    padding: 0,
    margin: "20px 0 0",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  previewRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
  },
  previewAvatar: {
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
  previewBody: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: "1 1 auto",
    minWidth: 0,
  },
  previewName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  previewMeta: {
    fontSize: 12.5,
    color: "var(--color-text-2)",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
  },
  previewRating: {
    fontSize: 13,
    color: "var(--color-text)",
    flex: "0 0 auto",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
  },
  previewStar: { color: "#f5a524" },
  previewReviewCount: { color: "var(--color-text-2)" },
};
