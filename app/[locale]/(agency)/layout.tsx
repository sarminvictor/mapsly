/**
 * Agency portal layout · the `.agency-portal` design-system scope + the
 * `.app` shell (dark icon rail + glass topbar) from the prototype.
 *
 * Phase 0/1 of the portal rebuild (see docs/portal-gap-analysis.md):
 *   - Loads Space Grotesk (--display), Inter (--font), JetBrains Mono
 *     (--mono) via next/font and exposes them as CSS variables consumed
 *     by `agency-portal.css` (the ported, scoped prototype stylesheet).
 *   - Wraps everything in `.agency-portal` so the cool-gray/indigo system
 *     never leaks into the SMB cream surfaces.
 *   - Renders the chrome (AgencyChrome): collapsible dark rail, glass
 *     topbar with breadcrumb + ⌘K + wallet + avatar.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 — the default export
 * is SYNC; async chrome (i18n + the DB-reading WalletPill) lives inside
 * Suspense boundaries so the shell prerenders. Auth is enforced per page.
 */

import { Suspense, type ReactNode } from "react";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { CommandK } from "@/components/agency/CommandK";
import { WalletPill } from "@/components/agency/WalletPill";
import { JobsTray } from "@/components/agency/JobsTray";
import { ToastHost } from "@/components/agency/Toast";
import {
  getRecentResearchLinks,
  type RecentResearchLink,
} from "@/modules/agency-portal/research/queries";
import {
  AgencyChrome,
  type AgencyChromeLabels,
} from "@/components/agency/AgencyChrome";

import "./agency-portal.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

interface LayoutParams {
  locale: string;
}

export default function AgencyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<LayoutParams>;
}) {
  return (
    <div
      className={`agency-portal ${inter.variable} ${spaceGrotesk.variable} ${jetbrains.variable}`}
    >
      <Suspense fallback={<ChromeFallback>{children}</ChromeFallback>}>
        <ChromeServer params={params}>{children}</ChromeServer>
      </Suspense>
      {/* WP4-11 · single toast host for the whole agency subtree — every
          client component fires via showToast() from @/components/agency/Toast. */}
      <ToastHost />
    </div>
  );
}

/** Static shell while the i18n labels resolve. */
function ChromeFallback({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <aside className="side" aria-hidden />
      <div className="main">
        <div className="topbar" />
        <main id="main" role="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

async function ChromeServer({
  params,
  children,
}: {
  params: Promise<LayoutParams>;
  children: ReactNode;
}) {
  await params;
  const t = await getTranslations("agency.nav");

  const labels: AgencyChromeLabels = {
    brand: t("brand"),
    getLeads: t("item_get_leads"),
    myResearch: t("item_my_research"),
    billing: t("item_billing"),
    settings: t("item_settings"),
    railToggle: t("rail_toggle"),
    openMenu: t("open_menu"),
    skipToContent: t("search_jump"),
  };

  // Recent researches for the ⌘K palette (WP4-7). Agency-scoped + cached
  // (getResearchList uses cacheLife("minutes")); [] when the user isn't on a
  // team yet or the read fails — the palette still shows jump commands + search.
  let recentResearches: RecentResearchLink[] = [];
  const session = await auth();
  if (session?.user?.id) {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (member) {
      recentResearches = await getRecentResearchLinks(member.agencyId);
    }
  }

  return (
    <AgencyChrome
      labels={labels}
      cmdk={<CommandK recentResearches={recentResearches} />}
      wallet={
        <Suspense fallback={null}>
          <WalletPill />
        </Suspense>
      }
      jobs={<JobsTray />}
    >
      {children}
    </AgencyChrome>
  );
}
