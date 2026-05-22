/**
 * Agency list detail · `/(agency)/lists/[id]` (locale-prefixed as
 * `/es/listas/[id]`, `/fr/listes/[id]`, etc.).
 *
 * Audience: Tom (the 4-seat agency owner). The list-detail surface is
 * where Tom triages a list's qualified leads — sees the pitch, the
 * 5-stat hero, the filters defining the list, status tabs, and the
 * leads table per active status.
 *
 * Reference design: `_design/agency/list-detail.html`.
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** · default export is SYNC; async body lives in a
 *     Suspense boundary so the route prerenders a shell under
 *     `experimental.cacheComponents: true`.
 *   - **Pattern 1** · `getAgencyListDetailData` short-circuits to
 *     `EMPTY_LIST_DETAIL` for the Vercel build phase, not-found,
 *     wrong-agency, and Prisma errors.
 *   - **Pattern 3** · `searchParams` (`?status=NEW`) is awaited INSIDE
 *     the Suspense'd inner component, never on the boundary.
 *   - **Pattern 4** · no `t.rich()` render-props · all interpolation
 *     resolves to plain strings server-side.
 *   - **Pattern 5** · no `export const dynamic` · Suspense wrap is the
 *     canonical "this route reads request data" signal.
 *
 * Auth: page is authenticated. Anonymous → `/signin` via
 * `unauthorized()`. Authenticated user with NO agency membership for
 * THIS list's agency → `notFound()` so we don't leak whether a list
 * exists across agencies.
 *
 * Per `.claude/rules/ui-ux-agency.md` and `.claude/rules/copy-voice.md`:
 *
 *   - Tool-y, precise, jargon-OK · Tom understands "Local 3-pack",
 *     "LCP", "schema markup".
 *   - Numbers over adjectives.
 *   - Imperative actions ("Clone list", "Export 47", "Open →").
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import {
  FilterTagsCard,
  ListDetailHero,
  StatusTabs,
  type StatusTabsLabels,
  type FilterTagsCardLabels,
  type ListDetailHeroLabels,
} from "@/modules/agency-portal/list-detail/components";
import { getAgencyListDetailData } from "@/modules/agency-portal/list-detail/queries";
import {
  LEAD_STATUS_TAB_ORDER,
  type LeadStatusValue,
} from "@/modules/agency-portal/list-detail/types";
import { StatusPill } from "@/modules/agency-portal/components";
import {
  LeadsTableInteractive,
  type InteractiveLeadRowData,
  type LeadsTableInteractiveLabels,
} from "@/modules/agency-portal/list-detail/components";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "agency.list_detail.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    // Authenticated surface — keep out of search results.
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
  id: string;
}

/**
 * Default export · SYNC shell wrapping the async body in Suspense so
 * Vercel's build worker prerenders this tree without touching DB or
 * auth (cache-components Pattern 2).
 */
export default function AgencyListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<ListDetailSkeleton />}>
      <ListDetailBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function ListDetailSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <div
        style={{
          height: 30,
          width: 320,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 18,
        }}
      />
      <div
        style={{
          height: 260,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          height: 80,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          marginBottom: 18,
        }}
      />
      <div
        style={{
          height: 360,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
        }}
      />
    </section>
  );
}

/* ------------------------------------------------------------- body */

async function ListDetailBody({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, search] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const activeStatus = pickActiveStatus(search?.status);

  const data = await getAgencyListDetailData(id, session.user.id, activeStatus);

  if (data.list === null) {
    notFound();
  }

  const t = await getTranslations("agency.list_detail");
  const tStatus = await getTranslations("agency.lead_status");
  const tCadence = await getTranslations("agency.list_detail.cadence");
  const tService = await getTranslations("agency.lists.service_templates");

  const list = data.list;
  // ListDetailBody is already a dynamic server component (it awaits
  // params, searchParams, auth) — reading Date.now() here for the
  // "created N days ago" hero stat is intentional and well-defined.
  // The react-hooks/purity rule applies to client render only.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  /* ------------------------------------------------ i18n label resolve */

  const serviceLabel = (() => {
    switch (list.serviceType) {
      case "WEBSITE_REBUILD":
        return tService("website");
      case "META_ADS_CAMPAIGN":
        return tService("meta_ads");
      case "GOOGLE_ADS_LAUNCH":
        return tService("google_ads");
      case "LOCAL_SEO":
        return tService("local_seo");
      case "REVIEW_MANAGEMENT":
        return tService("reviews");
      case "BRAND_DEFENSE":
        return tService("brand");
      case "NEW_BUSINESS_LAUNCH":
        return tService("launch");
      case "FULL_AUDIT":
        return tService("audit");
      default:
        return t("service_type_custom");
    }
  })();

  const heroLabels: ListDetailHeroLabels = {
    pitchLead: t("hero.pitch_lead"),
    qualifiedLabel: t("hero.qualified_label"),
    newThisWeekLabel: t("hero.new_this_week_label"),
    contactedLabel: t("hero.contacted_label"),
    refreshLabel: t("hero.refresh_label"),
    createdLabel: t("hero.created_label"),
    qualifiedMeta: (totalQualified) =>
      t("hero.qualified_meta", { count: totalQualified }),
    newThisWeekMeta: (priorWeek) =>
      t("hero.new_this_week_meta", { prior: priorWeek }),
    contactedMeta: (pct) => t("hero.contacted_meta", { pct }),
    refreshMeta: (cadence) => {
      if (cadence === "DAILY") return tCadence("daily_meta");
      if (cadence === "WEEKLY") return tCadence("weekly_meta");
      return tCadence("manual_meta");
    },
    createdMeta: (ownerName, ageDays) =>
      t("hero.created_meta", { owner: ownerName, days: ageDays }),
    refreshValue: (cadence) => {
      if (cadence === "DAILY") return tCadence("daily_value");
      if (cadence === "WEEKLY") return tCadence("weekly_value");
      return tCadence("manual_value");
    },
    formatShortDate: (date) =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
      }).format(date),
    pausedPill: t("hero.paused_pill"),
    activePill: t("hero.active_pill"),
    customServiceLabel: t("service_type_custom"),
  };

  const filterLabels: FilterTagsCardLabels = {
    heading: (count) => t("filters_card.heading", { count }),
    editAction: t("filters_card.edit_action"),
    emptyFallback: t("filters_card.empty_fallback"),
  };

  const statusLabels: StatusTabsLabels = {
    groupAriaLabel: t("status_tabs.group_aria"),
    statusLabel: {
      NEW: tStatus("new"),
      CONTACTED: tStatus("contacted"),
      REPLIED: tStatus("replied"),
      WON: tStatus("won"),
      LOST: tStatus("lost"),
      HIDDEN: tStatus("hidden"),
    },
  };

  const tableLabels: LeadsTableInteractiveLabels = {
    selectAria: t("table_select_aria"),
    business: t("table_business"),
    whyQualified: t("table_why_qualified"),
    status: t("table_status"),
    contact: t("table_contact"),
    actions: t("table_actions"),
    caption: t("table_caption"),
    openLabel: t("table_open"),
    openAria: (business: string) => t("table_open_aria", { business }),
    noContact: t("table_no_contact"),
    selectedNoun: (count: number) => t("table_bulk_selected_meta", { count }),
    bulkMarkContacted: t("table_bulk_mark_contacted"),
    bulkMarkReplied: t("table_bulk_mark_replied"),
    bulkMarkLost: t("table_bulk_mark_lost"),
    bulkHide: t("table_bulk_hide"),
    bulkClear: t("table_bulk_clear"),
    statusError: t("table_status_error"),
  };

  /* ------------------------------------------------------ rendered */

  return (
    <section
      aria-labelledby="list-detail-hero-title"
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      {/* Breadcrumb */}
      <nav
        aria-label={t("breadcrumb_aria")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
          marginBottom: 16,
        }}
      >
        <Link
          href={{ pathname: "/lists" }}
          style={{ color: "inherit", textDecoration: "none" }}
        >
          {t("breadcrumb_lists")}
        </Link>
        <span aria-hidden="true" style={{ color: "var(--color-border)" }}>
          /
        </span>
        <span>{list.name}</span>
      </nav>

      {/* Title row · clone / edit / export actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--color-text-2)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {t("subtitle_agency", { agency: list.agencyName })}
        </p>
        <div
          style={{
            display: "inline-flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href={{ pathname: "/hunter" }}
            data-testid="edit-filters-link"
            style={ghostButtonStyle()}
          >
            {t("action_edit_filters")}
          </Link>
          <span style={primaryButtonStyle()}>
            {t("action_export", { count: data.totalLeads })}
          </span>
        </div>
      </div>

      {/* Hero · pitch + 5 stats */}
      <ListDetailHero
        data={{
          ...list,
          qualifiedCount: data.statusCounts.NEW,
          contactedCount: data.statusCounts.CONTACTED,
          newThisWeekCount: data.newThisWeekCount,
          newPriorWeekCount: data.newPriorWeekCount,
          totalLeads: data.totalLeads,
        }}
        labels={heroLabels}
        serviceLabel={serviceLabel}
        nowMs={nowMs}
      />

      {/* Filter chips card · "what defines this list" */}
      <FilterTagsCard
        tags={data.filterTags}
        labels={filterLabels}
        editLink={
          <Link
            href={{ pathname: "/hunter" }}
            data-testid="filter-tags-edit-link"
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-2)",
              color: "var(--color-text-2)",
              fontSize: 11.5,
              fontWeight: 600,
              textDecoration: "none",
              fontFamily: "var(--font-sans)",
              whiteSpace: "nowrap",
            }}
          >
            {filterLabels.editAction}
          </Link>
        }
      />

      {/* Status tabs */}
      <StatusTabs
        counts={data.statusCounts}
        activeStatus={activeStatus}
        labels={statusLabels}
        linkFor={(status, node) => (
          <Link
            // Same logical route · only the search param changes.
            href={
              {
                pathname: "/lists/[id]",
                params: { id: list.id },
                query: { status },
              } as never
            }
            data-status-link={status}
            style={{ textDecoration: "none" }}
          >
            {node}
          </Link>
        )}
      />

      {/* Leads table — interactive (selection + status cycle + bulk
          actions). Per .claude/rules/ui-ux-agency.md status pills
          cycle on click and a sticky BulkActionBar appears the moment
          ≥1 row is selected. */}
      {data.leads.length === 0 ? (
        <EmptyLeadsCard
          status={activeStatus}
          label={t("empty_state", {
            status: statusLabels.statusLabel[activeStatus].toLowerCase(),
          })}
        />
      ) : (
        <LeadsTableInteractive
          leads={data.leads.map<InteractiveLeadRowData>((lead) => ({
            id: lead.id,
            businessId: lead.businessId,
            businessName: lead.businessName,
            meta: lead.meta,
            avatar: lead.avatar,
            avatarTone: lead.avatarTone,
            signals: lead.signals.map((s) => ({
              tone: s.tone,
              label: s.label,
              title: s.title,
            })),
            status: lead.status,
            statusDwell: lead.statusDwell ?? undefined,
            contactEmail: lead.contactEmail ?? null,
            contactPhone: lead.contactPhone ?? null,
          }))}
          labels={tableLabels}
        />
      )}
    </section>
  );
}

/* ---------------------------------------------------------- helpers */

function pickActiveStatus(raw: string | string[] | undefined): LeadStatusValue {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return "NEW";
  const upper = v.toUpperCase() as LeadStatusValue;
  return LEAD_STATUS_TAB_ORDER.includes(upper) ? upper : "NEW";
}

function ghostButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 14px",
    borderRadius: 8,
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text)",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };
}

function primaryButtonStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 14px",
    borderRadius: 8,
    background: "var(--color-agency-indigo)",
    color: "#fff",
    border: "1px solid var(--color-agency-indigo)",
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
}

function EmptyLeadsCard({
  status,
  label,
}: {
  status: LeadStatusValue;
  label: string;
}) {
  return (
    <div
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "44px 24px",
        textAlign: "center",
        color: "var(--color-text-2)",
        fontSize: 13,
      }}
      data-testid="empty-leads-card"
      data-empty-status={status}
    >
      <p style={{ margin: 0 }}>{label}</p>
    </div>
  );
}
