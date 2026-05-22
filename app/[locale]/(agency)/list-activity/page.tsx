/**
 * Agency list-activity · `/(agency)/list-activity`.
 *
 * Tom drops in here to scan "what happened across my lists in the
 * last 14 days?" — status changes, new lead arrivals. A flat
 * 1-screen activity feed sorted DESC by time, capped at 50 rows.
 *
 * Per `_design/agency/list-activity.html` (when it lands) +
 * `.claude/rules/ui-ux-agency.md`:
 *
 *   - Header: title + agency subtitle + last-refresh meta line
 *   - Feed: dense mono rows, one per event, with status-tinted verb
 *     pill ("CONTACTED" / "REPLIED" / "WON" / "LOST") + deep-links
 *     to /prospect/[businessId] + /lists/[id]
 *   - Empty state honest about cadence ("Nothing happened in the
 *     last 14 days. Tweak filters or wait for next refresh.")
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** — default export is SYNC, body lives in a
 *     Suspense'd async inner component (auth + DB reads inside).
 *   - **Pattern 1** — `getAgencyActivityFeed` short-circuits to
 *     `EMPTY_AGENCY_ACTIVITY` for `NEXT_PHASE === 'phase-production-
 *     build'` + Prisma errors.
 *   - **Pattern 4** — no `t.rich()` render-props · all interpolation
 *     resolves to plain strings server-side.
 *   - **Pattern 5** — no `export const dynamic` · Suspense wrap is
 *     the canonical "this route reads request data" signal.
 *
 * Auth: page is authenticated. Anonymous → `unauthorized()`.
 * Authenticated user with NO `AgencyMember` row → redirect to
 * `/dashboard` (SMB surface).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  ActivityFeed,
  getAgencyActivityFeed,
  type ActivityFeedLabels,
  type ActivityItemData,
} from "@/modules/agency-portal/list-activity";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "agency.list_activity.meta",
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
}

export default function AgencyListActivityPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<ActivitySkeleton />}>
      <ActivityBody params={params} />
    </Suspense>
  );
}

/* ----------------------------------------------------- skeleton */

function ActivitySkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <div
        style={{
          height: 30,
          width: 220,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          display: "grid",
          gap: 8,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 56,
              background: "var(--color-bg-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
            }}
          />
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------- async body */

async function ActivityBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const data = await getAgencyActivityFeed(session.user.id);

  if (data.agencyId === "") {
    redirect({ href: "/dashboard", locale: locale as Locale });
  }

  const t = await getTranslations("agency.list_activity");

  // ─── locale-aware relative-time formatter ───────────────────
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const formatRelative = (iso: string): string => relativeTime(iso, rtf);

  const feedLabels: ActivityFeedLabels = {
    feedAria: t("feed_aria"),
    emptyTitle: t("empty_title"),
    emptyBody: t("empty_body"),
    cappedFooter: ({ shown, total }) => t("capped_footer", { shown, total }),
    lastRefreshLabel: (relative) => t("last_refresh_label", { relative }),
    row: {
      verb: {
        lead_new: t("verb_new"),
        lead_contacted: t("verb_contacted"),
        lead_replied: t("verb_replied"),
        lead_won: t("verb_won"),
        lead_lost: t("verb_lost"),
      },
      statusPill: (status) => t(`status_pill_${status.toLowerCase()}`),
      relativeTime: formatRelative,
      rowAria: ({ businessName, verb, relativeTime: rt }) =>
        t("row_aria", { businessName, verb, relativeTime: rt }),
      inListConnector: t("in_list_connector"),
    },
  };

  const linkForItem = (
    item: ActivityItemData,
  ): { businessLink: React.ReactNode; listLink: React.ReactNode } => ({
    businessLink: (
      <Link
        href={{
          pathname: "/prospect/[businessId]",
          params: { businessId: item.businessId },
        }}
        data-testid={`activity-business-link-${item.id}`}
        style={{
          color: "var(--color-text)",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        {item.businessName}
      </Link>
    ),
    listLink: (
      <Link
        href={{
          pathname: "/lists/[id]",
          params: { id: item.listId },
        }}
        data-testid={`activity-list-link-${item.id}`}
        style={{
          color: "var(--color-agency-indigo)",
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        {item.listName}
      </Link>
    ),
  });

  const lastRefreshRelative = data.lastListRefresh
    ? formatRelative(data.lastListRefresh)
    : null;

  return (
    <section
      aria-labelledby="list-activity-heading"
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <header style={{ marginBottom: 22 }}>
        <h1
          id="list-activity-heading"
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
      </header>

      <ActivityFeed
        items={data.items}
        totalEvents={data.totalEvents}
        lastListRefreshRelative={lastRefreshRelative}
        labels={feedLabels}
        linkForItem={linkForItem}
      />
    </section>
  );
}

/**
 * Format an ISO timestamp as a locale-aware relative time string.
 *
 * Wraps `Intl.RelativeTimeFormat` with a "pick the best unit" heuristic:
 * minutes for < 1h, hours for < 24h, days otherwise. Always negative
 * (past events) — the feed only ever shows past events.
 */
function relativeTime(iso: string, rtf: Intl.RelativeTimeFormat): string {
  const ms = Date.parse(iso) - Date.now();
  const absSec = Math.abs(ms) / 1000;
  if (absSec < 60) return rtf.format(0, "minute");
  if (absSec < 3600) {
    return rtf.format(Math.round(ms / 60_000), "minute");
  }
  if (absSec < 86_400) {
    return rtf.format(Math.round(ms / 3_600_000), "hour");
  }
  return rtf.format(Math.round(ms / 86_400_000), "day");
}
