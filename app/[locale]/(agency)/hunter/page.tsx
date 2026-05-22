/**
 * Agency Hunter · `/(agency)/hunter` (locale-prefixed: `/es/cazador`,
 * `/fr/chasseur`, `/en-ca/hunter`).
 *
 * Mapsly's moat surface: a 3-step flow (service template → market →
 * tune 60+ signal filters) that compiles a qualified-lead list from
 * the 2.1M business index. Per `.claude/rules/ui-ux-agency.md`:
 *
 *   - Tool-y, dense, indigo accent, jargon-OK
 *   - Numbers over adjectives, imperative buttons
 *   - Sticky preview bar with live match count (live count wires later)
 *
 * Today is the **F.2 scaffold slice**. The page renders all three steps
 * end-to-end, reuses existing components (`ServiceTemplateStrip` glyph
 * map + filter signal registry), and stubs the live count + save-as-list.
 * Follow-up tasks deepen:
 *
 *   - F.2.1 · debounced live match count via D.4 evaluator
 *   - F.2.2 · editable filter values + comparator picker
 *   - F.2.3 · save-as-list server action
 *   - F.2.4 · ⌘K command palette + Tab focus order audit
 *
 * NOTE on URL: the brief targets `/(agency)/search`, but the SMB
 * visibility page already owns `/search` (a Next.js route group
 * collision would throw at build). `/hunter` is the agency-portal-
 * native vocabulary anyway — Tom calls it "the hunter".
 *
 * Per `.claude/rules/cache-components.md`:
 *   - **Pattern 2** — default export is SYNC, async body lives in Suspense
 *   - **Pattern 3** — `searchParams` is awaited INSIDE the Suspense'd inner
 *   - **Pattern 4** — no `t.rich()`; plain string returns only
 *   - **Pattern 5** — no `export const dynamic`; Suspense IS the signal
 *
 * Auth mirrors `/(agency)/lists/page.tsx`:
 *   - No session → `unauthorized()` (Next 16 auth interrupt)
 *   - Session but no AgencyMember → `redirect('/dashboard')`
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import type { Locale } from "@/i18n/routing";
import { CATEGORIES_ORDERED, SIGNALS_ORDERED } from "@/modules/signals";
import { SERVICE_TEMPLATES } from "@/modules/agency-portal/lists/service-templates";
import {
  HunterStepper,
  HunterTemplatePicker,
  HunterMarketTarget,
  HunterFiltersGrid,
  HunterPreviewBarLive,
} from "@/modules/agency-portal/hunter/components";

interface PageParams {
  locale: string;
}

interface PageSearchParams {
  template?: string;
  step?: string;
  category?: string;
}

interface PageProps {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agency.hunter.meta" });
  return {
    title: t("title"),
    description: t("description"),
    // Authenticated surface — keep out of search results.
    robots: { index: false, follow: false },
  };
}

/**
 * Default export · SYNC shell with a Suspense'd async body. Per
 * cache-components Pattern 2, the shell itself does ZERO async work so
 * Vercel's build worker prerenders this tree without touching DB / auth.
 */
export default function HunterPage(props: PageProps) {
  return (
    <Suspense fallback={<HunterSkeleton />}>
      <HunterBody {...props} />
    </Suspense>
  );
}

function HunterSkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: "32px 24px 96px",
      }}
    >
      <div
        style={{
          height: 32,
          width: 240,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          height: 56,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          marginBottom: 22,
        }}
      />
      <div
        style={{
          height: 320,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
        }}
      />
    </section>
  );
}

async function HunterBody({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Per cache-components Pattern 3 · awaited INSIDE the Suspense'd inner.
  const sp = await searchParams;

  const session = await auth();
  if (!session?.user?.id) {
    unauthorized();
  }

  // Reuse the same membership shape the lists page uses: if the user
  // isn't an AgencyMember, bounce them to the SMB dashboard rather than
  // render an empty agency shell.
  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, agencyId: true },
  });
  if (!member) {
    redirect({ href: "/dashboard", locale: locale as Locale });
  }

  const t = await getTranslations({ locale, namespace: "agency.hunter" });

  // Resolve current step from searchParams · default to 1
  const currentStep: 1 | 2 | 3 = (() => {
    const n = Number(sp.step);
    if (n === 2) return 2;
    if (n === 3) return 3;
    return 1;
  })();

  // Group signals by category for step 3 rendering. CATEGORIES_ORDERED
  // is already sorted by sortOrder.
  const signalsByCategory = CATEGORIES_ORDERED.map((cat) => ({
    category: cat,
    signals: SIGNALS_ORDERED.filter((s) => s.category === cat.key),
  }));

  // Pre-resolve i18n strings for the template picker — explicit record
  // form mirrors the lists page pattern so the record-literal type is
  // inferred (Object.fromEntries widens too aggressively for typed keys).
  const templateLabels = {
    website: t("templates.website.label"),
    meta_ads: t("templates.meta_ads.label"),
    google_ads: t("templates.google_ads.label"),
    local_seo: t("templates.local_seo.label"),
    reviews: t("templates.reviews.label"),
    brand: t("templates.brand.label"),
    launch: t("templates.launch.label"),
    audit: t("templates.audit.label"),
  };

  const templateMetas = {
    website: t("templates.website.meta"),
    meta_ads: t("templates.meta_ads.meta"),
    google_ads: t("templates.google_ads.meta"),
    local_seo: t("templates.local_seo.meta"),
    reviews: t("templates.reviews.meta"),
    brand: t("templates.brand.meta"),
    launch: t("templates.launch.meta"),
    audit: t("templates.audit.meta"),
  };

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "32px 24px 120px",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <header>
        <h1
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            margin: 0,
            color: "var(--color-text)",
          }}
        >
          {t("title")}
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-text-3)",
          }}
        >
          {t("subtitle")}
        </p>
      </header>

      <HunterStepper
        currentStep={currentStep}
        labels={{
          step1: t("step1_label"),
          step2: t("step2_label"),
          step3: t("step3_label"),
        }}
      />

      {currentStep === 1 ? (
        <HunterTemplatePicker
          templates={SERVICE_TEMPLATES}
          activeTemplateKey={sp.template ?? null}
          labels={{
            heading: t("step1_heading"),
            subheading: t("step1_prompt"),
            templateLabels,
            templateMetas,
            continueCta: t("step1_continue"),
          }}
        />
      ) : null}

      {currentStep === 2 ? (
        <HunterMarketTarget
          template={sp.template ?? null}
          category={sp.category ?? null}
          labels={{
            heading: t("step2_heading"),
            subheading: t("step2_subheading"),
            categoryLabel: t("step2_category_label"),
            categoryPlaceholder: t("step2_category_placeholder"),
            cityLabel: t("step2_city_label"),
            cityPlaceholder: t("step2_city_placeholder"),
            radiusLabel: t("step2_radius_label"),
            radiusPlaceholder: t("step2_radius_placeholder"),
            continueCta: t("step2_continue"),
            backCta: t("step2_back"),
          }}
        />
      ) : null}

      {currentStep === 3 ? (
        <HunterFiltersGrid
          groups={signalsByCategory}
          labels={{
            heading: t("step3_heading"),
            subheading: t("step3_subheading"),
            readonlyNotice: t("step3_readonly_notice"),
            backCta: t("step3_back"),
          }}
        />
      ) : null}

      <HunterPreviewBarLive
        currentStep={currentStep}
        labels={{
          countSuffix: t("preview_bar.count_suffix"),
          countPlaceholder: t("preview_bar.count_placeholder"),
          loading: t("preview_bar.loading"),
          summaryStep1: t("preview_bar.summary_step1"),
          summaryStep2: t("preview_bar.summary_step2"),
          summaryStep3: t("preview_bar.summary_step3"),
          saveCta: t("preview_bar.save_cta"),
          saveDisabledHint: t("preview_bar.save_disabled_hint"),
        }}
      />
    </main>
  );
}
