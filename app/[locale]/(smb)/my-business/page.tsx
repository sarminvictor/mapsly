/**
 * SMB "My Business" · `/(smb)/my-business`.
 *
 * Audience: Maria. Per `.claude/rules/ui-ux-smb.md`:
 *   - Warm, plain English. "What you offer" not "Manage services".
 *   - One focal section per block. Mobile-first (380px tap targets).
 *   - No jargon. Services are the lens — explain it that way.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2: SYNC default export + Suspense'd async body. Auth and
 *     DB read live inside the boundary so the shell prerenders.
 *   - Pattern 1: queries.ts uses the NEXT_PHASE guard returning EMPTY.
 *
 * Per `.claude/rules/security.md`:
 *   - `auth()` at the top of the inner body; `unauthorized()` interrupt.
 *
 * Per `.claude/rules/i18n.md`:
 *   - All copy in `messages/en.json` under `smb.my_business.*`. Other
 *     locales follow as separate i18n tasks.
 *
 * The structure:
 *
 *   1. Header · "What you offer" + plain-English explanation of WHY
 *      services drive the rest of the analysis.
 *   2. Services editor · add / rename / remove / reorder list. Soft
 *      delete for auto-detected services (so the cron doesn't re-add).
 *   3. Business profile snapshot · read-only (Google source of truth).
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
  getSmbMyBusinessData,
  addService,
  renameService,
  removeService,
  restoreService,
  reorderServices,
  type SmbMyBusinessData,
} from "@/modules/smb-my-business";

import { ServicesEditor } from "@/components/smb/my-business/ServicesEditor";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "smb.my_business.meta",
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

export default function SmbMyBusinessPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<MyBusinessSkeleton />}>
      <MyBusinessBody params={params} />
    </Suspense>
  );
}

function MyBusinessSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <div
        style={{
          height: 28,
          width: 240,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 160,
            background: "var(--color-bg-2)",
            borderRadius: 16,
            marginBottom: 16,
          }}
        />
      ))}
    </section>
  );
}

async function MyBusinessBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const portalMismatch = await requirePortal(session.user.id, "smb");
  if (portalMismatch) {
    redirect({ href: portalMismatch.redirectTo, locale: locale as Locale });
  }

  const t = await getTranslations("smb.my_business");
  const data = await getSmbMyBusinessData(session.user.id);

  return (
    <section
      aria-labelledby="my-business-heading"
      style={{
        maxWidth: 760,
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
          id="my-business-heading"
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

      {data.ownedBusinessId === "" ? (
        <EmptyBusinessCard
          labels={{
            heading: t("empty_heading"),
            body: t("empty_body"),
            finish_setup: t("empty_cta"),
          }}
        />
      ) : (
        <>
          <ServicesCard
            data={data}
            labels={{
              heading: t("services_heading"),
              subtitle: t("services_subtitle"),
              add_cta: t("services_add_cta"),
              add_name_label: t("services_add_name_label"),
              add_name_placeholder: t("services_add_name_placeholder"),
              add_category_label: t("services_add_category_label"),
              add_category_placeholder: t("services_add_category_placeholder"),
              add_description_label: t("services_add_description_label"),
              add_description_placeholder: t(
                "services_add_description_placeholder",
              ),
              add_submit: t("services_add_submit"),
              add_cancel: t("services_add_cancel"),
              empty_heading: t("services_empty_heading"),
              empty_body: t("services_empty_body"),
              row_edit: t("services_row_edit"),
              row_remove: t("services_row_remove"),
              row_restore: t("services_row_restore"),
              row_save: t("services_row_save"),
              row_cancel: t("services_row_cancel"),
              row_source_manual: t("services_row_source_manual"),
              row_source_auto_google: t("services_row_source_auto_google"),
              row_source_auto_dom: t("services_row_source_auto_dom"),
              row_inactive_pill: t("services_row_inactive_pill"),
              row_no_category: t("services_row_no_category"),
              row_no_description: t("services_row_no_description"),
              section_active: t("services_section_active"),
              section_inactive: t("services_section_inactive"),
              section_inactive_help: t("services_section_inactive_help"),
              reorder_help: t("services_reorder_help"),
              move_up: t("services_move_up"),
              move_down: t("services_move_down"),
            }}
          />

          <BusinessProfileCard
            data={data}
            labels={{
              heading: t("profile_heading"),
              subtitle: t("profile_subtitle"),
              name_label: t("profile_name_label"),
              address_label: t("profile_address_label"),
              category_label: t("profile_category_label"),
              website_label: t("profile_website_label"),
              phone_label: t("profile_phone_label"),
              source_note: t("profile_source_note"),
              dash: t("dash"),
            }}
          />
        </>
      )}
    </section>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

interface EmptyLabels {
  heading: string;
  body: string;
  finish_setup: string;
}

function EmptyBusinessCard({ labels }: { labels: EmptyLabels }) {
  return (
    <section style={cardStyle()}>
      <h2 style={cardTitleStyle()}>{labels.heading}</h2>
      <p style={cardBodyTextStyle()}>{labels.body}</p>
      <Link href="/onboarding" style={primaryButtonStyle()}>
        {labels.finish_setup}
      </Link>
    </section>
  );
}

// ─── Services card · wraps the client editor ───────────────────────────────

interface ServicesLabels {
  heading: string;
  subtitle: string;
  add_cta: string;
  add_name_label: string;
  add_name_placeholder: string;
  add_category_label: string;
  add_category_placeholder: string;
  add_description_label: string;
  add_description_placeholder: string;
  add_submit: string;
  add_cancel: string;
  empty_heading: string;
  empty_body: string;
  row_edit: string;
  row_remove: string;
  row_restore: string;
  row_save: string;
  row_cancel: string;
  row_source_manual: string;
  row_source_auto_google: string;
  row_source_auto_dom: string;
  row_inactive_pill: string;
  row_no_category: string;
  row_no_description: string;
  section_active: string;
  section_inactive: string;
  section_inactive_help: string;
  reorder_help: string;
  move_up: string;
  move_down: string;
}

function ServicesCard({
  data,
  labels,
}: {
  data: SmbMyBusinessData;
  labels: ServicesLabels;
}) {
  return (
    <section aria-labelledby="services-heading" style={cardStyle()}>
      <h2 id="services-heading" style={cardTitleStyle()}>
        {labels.heading}
      </h2>
      <p style={cardSubtitleStyle()}>{labels.subtitle}</p>

      <ServicesEditor
        services={data.services}
        labels={labels}
        actions={{
          add: addService,
          rename: renameService,
          remove: removeService,
          restore: restoreService,
          reorder: reorderServices,
        }}
      />
    </section>
  );
}

// ─── Business profile snapshot · read-only ─────────────────────────────────

interface ProfileLabels {
  heading: string;
  subtitle: string;
  name_label: string;
  address_label: string;
  category_label: string;
  website_label: string;
  phone_label: string;
  source_note: string;
  dash: string;
}

function BusinessProfileCard({
  data,
  labels,
}: {
  data: SmbMyBusinessData;
  labels: ProfileLabels;
}) {
  const addressLine = [
    data.businessAddress,
    data.businessCity,
    data.businessProvince,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section aria-labelledby="profile-heading" style={cardStyle()}>
      <h2 id="profile-heading" style={cardTitleStyle()}>
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
      </dl>
      <p style={footnoteStyle()}>{labels.source_note}</p>
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
