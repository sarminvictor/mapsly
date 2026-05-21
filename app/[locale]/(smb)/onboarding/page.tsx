/**
 * SMB onboarding · `/(smb)/onboarding` (locale variants `/es/bienvenida`,
 * `/fr/bienvenue`). Four-step wizard:
 *
 *   1. Claim business — show the user's already-linked business (read
 *      from DB) or a warm "we haven't matched you yet" empty state.
 *   2. Set vocabulary — radios (med-spa, restaurant, etc.) that tailor
 *      the words shown across the dashboard.
 *   3. Connect Google Business Profile — "Coming soon" stub button.
 *   4. Invite team — email + role row with an "Add another" affordance.
 *
 * Every step has "Skip for now"; the final step's "Finish setup" runs
 * `finishOnboarding()` → redirects to `/dashboard`.
 *
 * Step state lives in the URL (`?step=1..4`) so the route stays
 * streamable under `cacheComponents`, refreshing keeps state, and
 * browser back navigates the wizard.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 — default export is SYNC; async body Suspense'd.
 *   - Pattern 3 — `searchParams` awaited INSIDE the inner component.
 *
 * Audience: Maria (SMB). Voice: warm, plain English, one CTA per
 * screen, mobile-first per `.claude/rules/ui-ux-smb.md`.
 */

import { Suspense, type CSSProperties, type ReactNode } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link } from "@/i18n/navigation";

import {
  finishOnboarding,
  inviteTeammate,
} from "@/modules/smb-onboarding/actions";
import { getSmbOnboardingData } from "@/modules/smb-onboarding/queries";
import {
  parseStep,
  TOTAL_STEPS,
  VOCABULARY_OPTIONS,
  type OnboardingStep,
  type SmbOnboardingData,
  type Vocabulary,
} from "@/modules/smb-onboarding/types";
import { StepIndicator } from "@/modules/smb-onboarding/components/StepIndicator";
import { VocabularyRadio } from "@/modules/smb-onboarding/components/VocabularyRadio";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "smb.onboarding.meta" });
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
export default function SmbOnboardingPage({
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
      <div style={{ ...styles.skel, height: 220 }} />
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

  const t = await getTranslations("smb.onboarding");
  const data = await getSmbOnboardingData(session.user.id);

  return (
    <section style={styles.shell}>
      <p style={styles.eyebrow}>{t("eyebrow")}</p>

      <StepIndicator
        current={step}
        labels={{
          step1: t("step1_label"),
          step2: t("step2_label"),
          step3: t("step3_label"),
          step4: t("step4_label"),
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

/** Returns the body of the active step. `t` is the next-intl
 *  `smb.onboarding`-scoped getter. */
function StepContent({
  step,
  t,
  data,
}: {
  step: OnboardingStep;
  t: (key: string, vars?: Record<string, string | number>) => string;
  data: SmbOnboardingData;
}) {
  if (step === 1) return <ClaimStep t={t} data={data} />;
  if (step === 2) return <VocabularyStep t={t} />;
  if (step === 3) return <GoogleStep t={t} />;
  return <TeamStep t={t} />;
}

/* ------------------------------------------------------------------ */
/* Step bodies                                                        */
/* ------------------------------------------------------------------ */

function ClaimStep({
  t,
  data,
}: {
  t: (k: string) => string;
  data: SmbOnboardingData;
}) {
  const linked = data.ownedBusinessId !== "";
  return (
    <>
      <h1 style={styles.title}>{t("title_step1")}</h1>
      <p style={styles.lead}>{t("intro_step1")}</p>
      {linked ? (
        <div style={styles.innerCard}>
          <p style={styles.eyebrowSmall}>{t("claim_linked_title")}</p>
          <p style={styles.businessName}>{data.ownedBusinessName}</p>
          {data.ownedBusinessCity && (
            <p style={styles.muted}>{data.ownedBusinessCity}</p>
          )}
          <p style={{ margin: "16px 0 0", fontSize: 15 }}>
            {t("claim_yours_question")}
          </p>
        </div>
      ) : (
        <div style={{ ...styles.innerCard, borderStyle: "dashed" }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>
            {t("claim_no_business_title")}
          </p>
          <p style={{ margin: "8px 0 0", ...styles.lead }}>
            {t("claim_no_business_body")}
          </p>
        </div>
      )}
    </>
  );
}

function VocabularyStep({ t }: { t: (k: string) => string }) {
  const options: ReadonlyArray<{ value: Vocabulary; label: string }> =
    VOCABULARY_OPTIONS.map((v) => ({ value: v, label: t(`vocab_${v}`) }));
  return (
    <>
      <h1 style={styles.title}>{t("title_step2")}</h1>
      <p style={styles.lead}>{t("intro_step2")}</p>
      <VocabularyRadio
        name="vocabulary"
        options={options}
        legend={t("vocab_legend")}
      />
    </>
  );
}

function GoogleStep({ t }: { t: (k: string) => string }) {
  return (
    <>
      <h1 style={styles.title}>{t("title_step3")}</h1>
      <p style={styles.lead}>{t("intro_step3")}</p>
      <p
        style={{
          margin: "12px 0 0",
          fontSize: 14,
          color: "var(--color-text-2)",
        }}
      >
        {t("google_what_we_use")}
      </p>
      <div style={{ marginTop: 20 }}>
        <button
          type="button"
          aria-disabled="true"
          disabled
          style={styles.stubButton}
        >
          {t("google_cta")} · {t("google_coming_soon")}
        </button>
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 13,
            color: "var(--color-text-2)",
          }}
        >
          {t("google_coming_soon_note")}
        </p>
      </div>
    </>
  );
}

function TeamStep({ t }: { t: (k: string) => string }) {
  return (
    <>
      <h1 style={styles.title}>{t("title_step4")}</h1>
      <p style={styles.lead}>{t("intro_step4")}</p>
      <form action={inviteTeammate} style={styles.form}>
        <FieldLabel htmlFor="onboarding-team-email">
          {t("team_email_label")}
        </FieldLabel>
        <input
          id="onboarding-team-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={t("team_email_placeholder")}
          style={styles.input}
        />
        <FieldLabel htmlFor="onboarding-team-role">
          {t("team_role_label")}
        </FieldLabel>
        <select
          id="onboarding-team-role"
          name="role"
          defaultValue="manager"
          style={styles.input}
        >
          <option value="owner">{t("team_role_owner")}</option>
          <option value="manager">{t("team_role_manager")}</option>
          <option value="staff">{t("team_role_staff")}</option>
        </select>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 13,
            color: "var(--color-text-2)",
          }}
        >
          {t("team_help")}
        </p>
        <button type="submit" style={styles.secondaryButton}>
          {t("team_add_another")}
        </button>
      </form>
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
  const prevStep = (step - 1) as OnboardingStep;
  const isFinal = step === TOTAL_STEPS;

  return (
    <div style={styles.footer}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {step > 1 && (
          <Link
            href={{ pathname: "/onboarding", query: { step: prevStep } }}
            style={styles.textLink}
          >
            {t("back")}
          </Link>
        )}
        {!isFinal && (
          <Link
            href={{ pathname: "/onboarding", query: { step: nextStep } }}
            style={styles.textLink}
          >
            {t("skip")}
          </Link>
        )}
      </div>
      {isFinal ? (
        <form action={finishOnboarding}>
          <button type="submit" style={styles.primaryButton}>
            {t("primary_finish")}
          </button>
        </form>
      ) : (
        <Link
          href={{ pathname: "/onboarding", query: { step: nextStep } }}
          style={{
            ...styles.primaryButton,
            display: "inline-flex",
            alignItems: "center",
            textDecoration: "none",
          }}
        >
          {t("primary_next")}
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const styles: Record<string, CSSProperties> = {
  shell: { maxWidth: 720, margin: "0 auto", padding: "32px 20px 64px" },
  skel: { background: "var(--color-bg-2)", borderRadius: 14 },
  eyebrow: {
    margin: "0 0 8px",
    fontSize: 13,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--color-coral, #c3553a)",
  },
  eyebrowSmall: {
    margin: 0,
    fontSize: 13,
    color: "var(--color-text-2)",
    letterSpacing: "0.02em",
  },
  card: {
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 16,
    padding: "28px 24px",
    marginBottom: 20,
  },
  innerCard: {
    marginTop: 20,
    padding: "16px 18px",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
  },
  title: {
    fontFamily: "var(--font-serif)",
    fontSize: "clamp(24px, 4vw, 32px)",
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "var(--color-text)",
  },
  lead: {
    margin: "12px 0 0",
    fontSize: 16,
    lineHeight: 1.55,
    color: "var(--color-text-2)",
  },
  muted: {
    margin: "2px 0 0",
    fontSize: 14,
    color: "var(--color-text-2)",
  },
  businessName: {
    margin: "4px 0 0",
    fontSize: 20,
    fontFamily: "var(--font-serif)",
    color: "var(--color-text)",
  },
  form: { marginTop: 20, display: "flex", flexDirection: "column", gap: 12 },
  fieldLabel: {
    display: "block",
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 6,
    color: "var(--color-text)",
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    fontSize: 16,
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    minHeight: 44,
    boxSizing: "border-box",
  },
  stubButton: {
    padding: "12px 18px",
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text-2)",
    fontSize: 15,
    fontWeight: 500,
    cursor: "not-allowed",
    minHeight: 44,
  },
  secondaryButton: {
    alignSelf: "flex-start",
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 500,
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    cursor: "pointer",
    minHeight: 44,
  },
  primaryButton: {
    padding: "12px 22px",
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 10,
    border: "none",
    background: "var(--color-coral, #c3553a)",
    color: "#fff",
    cursor: "pointer",
    minHeight: 44,
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
};
