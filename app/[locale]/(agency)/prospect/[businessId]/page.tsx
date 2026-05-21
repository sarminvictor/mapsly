/**
 * Agency prospect detail · `/(agency)/prospect/[businessId]`.
 *
 * Audience: Tom (the 4-seat agency owner). The prospect-detail
 * surface is the "closing weapon" — the page he sends to a
 * salesperson or screen-shares on a sales call. Hero + 6 KPIs + the
 * 4 numbered "pitch wedges" + collapsible signal blocks + right rail
 * with contact / appears-in / data sources.
 *
 * Reference design: `_design/agency/prospect.html`.
 *
 * Per `.claude/rules/cache-components.md`:
 *
 *   - **Pattern 2** · default export is SYNC; async body lives in a
 *     Suspense boundary so the route prerenders a shell under
 *     `experimental.cacheComponents: true`.
 *   - **Pattern 1** · `getAgencyProspectDetailData` short-circuits to
 *     `EMPTY_PROSPECT_DETAIL` for the Vercel build phase, not-found,
 *     wrong-agency, and Prisma errors.
 *   - **Pattern 3** · no `searchParams` on this route at v1 · if added
 *     later (`?fromList=`), it MUST be awaited INSIDE the Suspense'd
 *     inner component.
 *   - **Pattern 4** · no `t.rich()` render-props · all interpolation
 *     resolves to plain strings server-side.
 *   - **Pattern 5** · no `export const dynamic` · Suspense wrap is the
 *     canonical "this route reads request data" signal.
 *
 * Auth: page is authenticated. Anonymous → `unauthorized()`.
 * Authenticated user with NO `Lead` row matching this businessId in
 * one of their agencies → `notFound()`. We do NOT distinguish
 * "doesn't exist" from "not yours" — protects cross-agency leak.
 *
 * Per `.claude/rules/ui-ux-agency.md` + `.claude/rules/copy-voice.md`:
 *
 *   - Tool-y, precise, jargon-OK · "Reply rate 0% · 23 unanswered"
 *   - Numbers over adjectives
 *   - Imperative actions (Mark contacted · Generate one-pager)
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import {
  ProspectHero,
  ProspectStats,
  WhyQualifies,
  SignalBlock,
  ProspectRail,
  type ProspectHeroLabels,
  type ProspectStatsLabels,
  type WhyQualifiesLabels,
  type SignalBlockLabels,
  type ProspectRailLabels,
} from "@/modules/agency-portal/prospect-detail/components";
import { getAgencyProspectDetailData } from "@/modules/agency-portal/prospect-detail/queries";
import type { ProspectSignalBlockKey } from "@/modules/agency-portal/prospect-detail/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; businessId: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "agency.prospect_detail.meta",
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
  businessId: string;
}

/**
 * Default export · SYNC shell wrapping the async body in Suspense so
 * Vercel's build worker prerenders this tree without touching DB or
 * auth (cache-components Pattern 2).
 */
export default function AgencyProspectDetailPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<ProspectDetailSkeleton />}>
      <ProspectDetailBody params={params} />
    </Suspense>
  );
}

function ProspectDetailSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <div
        style={{
          height: 110,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          height: 100,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          height: 280,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          marginBottom: 18,
        }}
      />
      <div
        style={{
          height: 480,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
        }}
      />
    </section>
  );
}

/* ------------------------------------------------------------- body */

async function ProspectDetailBody({ params }: { params: Promise<PageParams> }) {
  const { locale, businessId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  const data = await getAgencyProspectDetailData(businessId, session.user.id);
  if (data.prospect === null) {
    notFound();
  }
  const prospect = data.prospect;

  const t = await getTranslations("agency.prospect_detail");
  const tSignals = await getTranslations("agency.prospect_detail.signals");

  /* --- compose i18n-resolved titles for the queries' English fallbacks --- */
  // The query layer returns signalBlocks with English fallback titles
  // (so the formula layer stays UI-framework-free). Here we re-map
  // them through the i18n catalog by `key` — never touch the bullets,
  // which are dense facts that don't translate cleanly at v1 (a
  // follow-up i18n task per `.claude/rules/i18n.md` will localize the
  // formula strings).
  const signalTitle: Record<ProspectSignalBlockKey, string> = {
    reviews: tSignals("reviews"),
    competitors: tSignals("competitors"),
    search: tSignals("search"),
    ads: tSignals("ads"),
    website: tSignals("website"),
  };

  const heroLabels: ProspectHeroLabels = {
    backToLists: t("hero.back_to_lists"),
    prev: t("hero.prev"),
    next: t("hero.next"),
    noPrev: t("nav.no_prev"),
    noNext: t("nav.no_next"),
    markContacted: t("hero.mark_contacted"),
    markClient: t("hero.mark_client"),
    generateOnePager: t("hero.generate_one_pager"),
    refreshedAt: (iso) => {
      try {
        const d = new Date(iso);
        return t("rail.refreshed_at", {
          date: new Intl.DateTimeFormat(locale, {
            month: "short",
            day: "numeric",
          }).format(d),
        });
      } catch {
        return t("rail.refreshed_at", { date: "—" });
      }
    },
  };

  const statsLabels: ProspectStatsLabels = {
    mapslyScore: t("stats.mapsly_score"),
    msiRank: t("stats.msi_rank"),
    rating: t("stats.rating"),
    reviewCount: t("stats.review_count"),
    replyRate: t("stats.reply_rate"),
    lighthousePerf: t("stats.lighthouse_perf"),
  };

  const whyLabels: WhyQualifiesLabels = {
    title: t("why.title"),
    subtitle: t("why.subtitle"),
    severityLabel: {
      critical: t("why.severity.critical"),
      warn: t("why.severity.warn"),
      ok: t("why.severity.ok"),
    },
  };

  const signalLabels: SignalBlockLabels = {
    refreshedAtPrefix: t("rail.refreshed_at", { date: "" }),
  };

  const railLabels: ProspectRailLabels = {
    contactTitle: t("rail.contact_title"),
    appearsInTitle: t("rail.appears_in_title"),
    appearsInEmpty: t("rail.appears_in_empty"),
    dataSourcesTitle: t("rail.data_sources_title"),
    refreshedAt: heroLabels.refreshedAt,
    notesTitle: t("rail.notes_title"),
    notesPlaceholder: t("rail.notes_placeholder"),
    notesSavePending: t("rail.notes_save_pending"),
    noPhone: t("rail.no_phone"),
    noEmail: t("rail.no_email"),
    noWebsite: t("rail.no_website"),
  };

  /* ---------------- prev / next + back nav --------------- */
  const prevLink =
    data.prevProspectId != null ? (
      <Link
        href={{
          pathname: "/prospect/[businessId]",
          params: { businessId: data.prevProspectId },
        }}
        data-testid="prospect-prev-link"
        style={prevNextLinkStyle()}
      >
        ← {t("hero.prev")}
      </Link>
    ) : null;

  const nextLink =
    data.nextProspectId != null ? (
      <Link
        href={{
          pathname: "/prospect/[businessId]",
          params: { businessId: data.nextProspectId },
        }}
        data-testid="prospect-next-link"
        style={prevNextLinkStyle()}
      >
        {t("hero.next")} →
      </Link>
    ) : null;

  const backLink = (
    <Link
      href={{ pathname: "/lists" }}
      data-testid="prospect-back-link"
      style={{ color: "inherit", textDecoration: "none" }}
    >
      {t("hero.back_to_lists")}
    </Link>
  );

  /* ---------------- appears-in links --------------- */
  const appearsInLinks = prospect.appearsInLists.map((l) => (
    <Link
      key={l.id}
      href={{ pathname: "/lists/[id]", params: { id: l.id } }}
      data-testid={`prospect-appears-in-${l.id}`}
      style={{
        color: "var(--color-agency-indigo)",
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {l.name}
    </Link>
  ));

  /* ---------------- re-title signal blocks via i18n --------------- */
  const localizedSignalBlocks = prospect.signalBlocks.map((b) => ({
    ...b,
    title: signalTitle[b.key],
  }));

  return (
    <section
      aria-labelledby="prospect-hero-title"
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "28px 24px 64px",
      }}
    >
      <ProspectHero
        prospect={prospect}
        labels={heroLabels}
        prevLink={prevLink}
        nextLink={nextLink}
        backLink={backLink}
        onePagerHref={`/api/reports/one-pager/${prospect.id}?locale=${encodeURIComponent(locale)}`}
      />

      <ProspectStats prospect={prospect} labels={statsLabels} />

      <WhyQualifies wedges={prospect.pitchWedges} labels={whyLabels} />

      <div
        style={{
          display: "grid",
          gap: 20,
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
        }}
        data-testid="prospect-detail-grid"
      >
        <div>
          {localizedSignalBlocks.map((b, idx) => (
            <SignalBlock
              key={b.key}
              block={b}
              labels={signalLabels}
              defaultOpen={idx === 0}
            />
          ))}
        </div>
        <ProspectRail
          prospect={prospect}
          labels={railLabels}
          appearsInLinks={appearsInLinks}
        />
      </div>

      <div
        style={{
          marginTop: 14,
          padding: "14px 18px",
          background: "var(--color-bg-3, #f3f4f6)",
          borderRadius: 10,
          fontSize: 11.5,
          color: "var(--color-text-3)",
          fontFamily: "var(--font-mono)",
          lineHeight: 1.6,
        }}
      >
        {t("footer_readonly")}
      </div>
    </section>
  );
}

function prevNextLinkStyle(): React.CSSProperties {
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
