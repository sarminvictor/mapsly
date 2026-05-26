/**
 * Agency lists · `/(agency)/lists` (locale-prefixed variants e.g.
 * `/es/listas`, `/fr/listes` already declared in `i18n/routing.ts`).
 *
 * Audience: Tom (the 4-seat agency owner). Per
 * `.claude/rules/ui-ux-agency.md`:
 *
 *   - Dense, scan-friendly, jargon-OK
 *   - Top: intro strip · "Today's new matches" hero · service templates
 *   - Middle: active lists grid · service badge + stats + hover actions
 *   - Bottom: paused lists row, dimmed
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** — the default export is SYNC. Async body (auth +
 *     cached query) lives inside a Suspense boundary so the route
 *     prerenders a shell under `experimental.cacheComponents: true`.
 *   - **Pattern 1** — `getAgencyListsData` short-circuits to EMPTY for
 *     the Vercel build phase + Prisma errors.
 *   - **Pattern 4** — no `t.rich()` render props; all interpolation is
 *     resolved at server-time and emitted as plain strings.
 *   - **Pattern 5** — no `export const dynamic`. Suspense wrap is the
 *     canonical "this route reads request data" signal.
 *
 * Auth: the page is authenticated. Anonymous visitors get redirected to
 * `/signin` via `unauthorized()` (Next 16 auth interrupts). Authenticated
 * users without an `AgencyMember` row get redirected to `/home`
 * (the SMB surface) so SMB-only users don't see a blank agency shell.
 *
 * Per `.claude/rules/copy-voice.md`:
 *
 *   - Tool-y, precise, no fluff. Jargon-OK (Tom knows it).
 *   - Numbers over adjectives.
 *   - Imperative actions ("New list", "Review →").
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  ListCard,
  ServiceTemplateStrip,
  TodayMatchesStrip,
  type ListCardLabels,
} from "@/modules/agency-portal/lists/components";
import { getAgencyListsData } from "@/modules/agency-portal/lists/queries";
import type { AgencyListSummary } from "@/modules/agency-portal/lists/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agency.lists.meta" });
  return {
    title: t("title"),
    description: t("description"),
    // Authenticated surface — keep out of search results.
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

/**
 * Default export · SYNC shell with a Suspense'd async body. The shell
 * itself does ZERO async work — Vercel's build worker prerenders this
 * tree without touching DB or auth. Per cache-components Pattern 2.
 */
export default function AgencyListsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<ListsSkeleton />}>
      <ListsBody params={params} />
    </Suspense>
  );
}

function ListsSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "32px 24px 64px",
      }}
    >
      <div
        style={{
          height: 30,
          width: 200,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          height: 96,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          height: 220,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 14,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 280,
              background: "var(--color-bg-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
            }}
          />
        ))}
      </div>
    </section>
  );
}

async function ListsBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const data = await getAgencyListsData(session.user.id);

  // Authenticated but no agency membership · bounce to the SMB surface
  // rather than rendering an empty agency shell. `redirect()` throws so
  // the rest of the body is unreachable for this branch.
  if (data.agencyId === "") {
    redirect({ href: "/home", locale: locale as Locale });
  }

  const t = await getTranslations("agency.lists");
  const tTpl = await getTranslations("agency.lists.service_templates");
  const tTplMeta = await getTranslations("agency.lists.service_template_metas");

  const templateLabels = {
    website: tTpl("website"),
    meta_ads: tTpl("meta_ads"),
    google_ads: tTpl("google_ads"),
    local_seo: tTpl("local_seo"),
    reviews: tTpl("reviews"),
    brand: tTpl("brand"),
    launch: tTpl("launch"),
    audit: tTpl("audit"),
  };
  const templateMetas = {
    website: tTplMeta("website"),
    meta_ads: tTplMeta("meta_ads"),
    google_ads: tTplMeta("google_ads"),
    local_seo: tTplMeta("local_seo"),
    reviews: tTplMeta("reviews"),
    brand: tTplMeta("brand"),
    launch: tTplMeta("launch"),
    audit: tTplMeta("audit"),
  };

  const cardLabels: ListCardLabels = {
    badge: "", // resolved per-card below
    newPill: (n) => t("card_new_pill", { count: n }),
    pausedPill: t("card_paused_pill"),
    qualifiedLabel: t("card_qualified_label"),
    thisWeekLabel: t("card_this_week_label"),
    engagedLabel: t("card_engaged_label"),
    verifiedEmailLabel: t("card_verified_email_label"),
    cadenceLabel: (cadence) => {
      if (cadence === "DAILY") return t("card_cadence_daily");
      if (cadence === "WEEKLY") return t("card_cadence_weekly");
      return t("card_cadence_manual");
    },
    cloneAction: t("card_action_clone"),
    pauseAction: t("card_action_pause"),
    resumeAction: t("card_action_resume"),
    moreAction: t("card_action_more"),
    targetLabel: ({ category, metro, radiusMi }) => {
      const parts: string[] = [];
      if (category) parts.push(category);
      if (metro) parts.push(metro);
      if (radiusMi != null) parts.push(`${radiusMi}mi`);
      return parts.length === 0
        ? t("card_target_any")
        : t("card_target_prefix", { target: parts.join(" · ") });
    },
    filterChipsLabel: t("card_filter_chips_label"),
    filterMoreLabel: (n) => t("card_filter_more", { count: n }),
  };

  const customServiceLabel = t("service_type_custom");
  const activeCount = data.active.length;
  const pausedCount = data.paused.length;
  const isEmpty = activeCount === 0 && pausedCount === 0;

  return (
    <section
      aria-labelledby="lists-heading"
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <div>
          <h1
            id="lists-heading"
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--color-text)",
            }}
          >
            {t("title")}
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--color-text-2)",
            }}
          >
            {t("subtitle_with_agency", { agency: data.agencyName })}
          </p>
        </div>
        <Link
          href={{ pathname: "/search" }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "10px 16px",
            borderRadius: 8,
            background: "var(--color-agency-indigo)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 13,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          + {t("create_list")}
        </Link>
      </header>

      {/* Intro · "what is a list" reassurance for first-time users */}
      <aside
        style={{
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 22,
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--color-text-2)",
        }}
      >
        {t("intro_body")}
      </aside>

      {/* Today's matches hero · only when there's at least one active list */}
      {activeCount > 0 ? (
        <TodayMatchesStrip
          total={data.totalNewThisWeek}
          label={t("today_strip_label")}
          detail={t("today_strip_detail", {
            new: data.totalNewThisWeek,
            lists: activeCount,
          })}
          meta={t("today_strip_meta")}
          cta={{ href: "/lists", label: t("today_strip_cta") }}
          verifiedEmail={
            data.totalVerifiedEmail > 0
              ? {
                  count: data.totalVerifiedEmail,
                  label: t("today_strip_verified_email", {
                    count: data.totalVerifiedEmail,
                  }),
                }
              : null
          }
        />
      ) : null}

      <ServiceTemplateStrip
        heading={t("templates_heading")}
        subheading={t("templates_sub")}
        templateLabels={templateLabels}
        templateMetas={templateMetas}
      />

      {isEmpty ? (
        <EmptyState
          title={t("empty_title")}
          body={t("empty_state")}
          ctaHref="/hunter"
          ctaLabel={t("empty_cta")}
        />
      ) : null}

      {activeCount > 0 ? (
        <section
          aria-labelledby="active-lists-heading"
          style={{ marginTop: 4 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              margin: "8px 0 14px",
            }}
          >
            <h2
              id="active-lists-heading"
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "var(--color-text)",
              }}
            >
              {t("active_heading")}
            </h2>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-3)",
              }}
            >
              {t("active_meta", { count: activeCount })}
            </span>
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 14,
            }}
          >
            {data.active.map((list) => (
              <li key={list.id}>
                <ListCard
                  list={list}
                  customServiceLabel={customServiceLabel}
                  labels={{
                    ...cardLabels,
                    badge: resolveServiceLabel(t, list),
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pausedCount > 0 ? (
        <section
          aria-labelledby="paused-lists-heading"
          style={{ marginTop: 32 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              margin: "8px 0 14px",
            }}
          >
            <h2
              id="paused-lists-heading"
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "var(--color-text)",
              }}
            >
              {t("paused_heading")}
            </h2>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-3)",
              }}
            >
              {t("paused_meta", { count: pausedCount })}
            </span>
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 14,
            }}
          >
            {data.paused.map((list) => (
              <li key={list.id}>
                <ListCard
                  list={list}
                  customServiceLabel={customServiceLabel}
                  labels={{
                    ...cardLabels,
                    badge: resolveServiceLabel(t, list),
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

/** Empty state · shown when an agency has 0 lists (active or paused). */
function EmptyState({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref: "/hunter";
  ctaLabel: string;
}) {
  return (
    <section
      style={{
        background: "var(--color-bg-2)",
        border: "1px dashed var(--color-border)",
        borderRadius: 14,
        padding: "40px 24px",
        textAlign: "center",
        marginBottom: 22,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: "8px auto 18px",
          maxWidth: 520,
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--color-text-2)",
        }}
      >
        {body}
      </p>
      <Link
        href={{ pathname: ctaHref }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "10px 18px",
          borderRadius: 8,
          background: "var(--color-agency-indigo)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 13,
          textDecoration: "none",
        }}
      >
        {ctaLabel}
      </Link>
    </section>
  );
}

/** Resolve the i18n label for a Prisma `ListServiceType` enum value. */
function resolveServiceLabel(
  t: (key: string) => string,
  list: AgencyListSummary,
): string {
  switch (list.serviceType) {
    case "WEBSITE_REBUILD":
      return t("service_templates.website");
    case "META_ADS_CAMPAIGN":
      return t("service_templates.meta_ads");
    case "GOOGLE_ADS_LAUNCH":
      return t("service_templates.google_ads");
    case "LOCAL_SEO":
      return t("service_templates.local_seo");
    case "REVIEW_MANAGEMENT":
      return t("service_templates.reviews");
    case "BRAND_DEFENSE":
      return t("service_templates.brand");
    case "NEW_BUSINESS_LAUNCH":
      return t("service_templates.launch");
    case "FULL_AUDIT":
      return t("service_templates.audit");
    case "CUSTOM":
      return t("service_type_custom");
  }
}
