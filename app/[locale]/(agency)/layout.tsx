/**
 * Agency portal layout · sidebar + topbar + main content shell.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Cool gray + indigo palette (`--color-agency-bg`, `--color-agency-indigo`)
 *   - Sticky 240px sidebar on desktop, horizontal scroll-tab strip on
 *     mobile (≤ 899px). Grid + media queries live in `app/globals.css`
 *     under `.agency-shell` / `.agency-nav`.
 *   - Topbar carries the brand, current workspace tag, and the ⌘K
 *     global business-search trigger (`CommandK`).
 *
 * Per `.claude/rules/cache-components.md` Pattern 2, the default
 * export is SYNC; async chrome (translation resolution) lives in a
 * Suspense boundary so the shell can prerender empty.
 *
 * Auth is enforced on each page — NOT in the layout — for the same
 * cacheComponents reason.
 */

import { Suspense, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { CommandK } from "@/components/agency/CommandK";
import { WalletPill } from "@/components/agency/WalletPill";
import { JobsTray } from "@/components/agency/JobsTray";
import {
  AgencySidebar,
  type AgencySidebarLabels,
} from "@/components/agency/AgencySidebar";

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
      style={
        {
          ["--color-bg" as string]: "var(--color-agency-bg)",
        } as React.CSSProperties
      }
      className="agency-shell"
    >
      <Suspense fallback={<AgencySidebarShell />}>
        <AgencySidebarServer params={params} />
      </Suspense>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Suspense fallback={<AgencyHeaderShell />}>
          <AgencyHeader params={params} />
        </Suspense>
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}

function AgencySidebarShell() {
  return <div aria-hidden className="agency-nav" style={{ minHeight: 200 }} />;
}

async function AgencySidebarServer({
  params,
}: {
  params: Promise<LayoutParams>;
}) {
  await params;
  const t = await getTranslations("agency.nav");

  const labels: AgencySidebarLabels = {
    brand: t("brand"),
    audienceTag: t("audience_tag"),
    sections: {
      workspace: t("section_workspace"),
      insight: t("section_insight"),
      account: t("section_account"),
    },
    items: {
      discover: t("item_discover"),
      campaigns: t("item_campaigns"),
      touchpoints: t("item_touchpoints"),
      agency_settings: t("item_agency_settings"),
      team_billing: t("item_team_billing"),
    },
  };

  return <AgencySidebar labels={labels} />;
}

function AgencyHeaderShell() {
  return (
    <div
      aria-hidden
      style={{
        padding: "12px 24px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-2)",
        height: 48,
      }}
    />
  );
}

async function AgencyHeader({ params }: { params: Promise<LayoutParams> }) {
  await params;
  const t = await getTranslations("agency.nav");
  return (
    <header
      style={{
        padding: "10px 24px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-3)",
        }}
      >
        {t("topbar_tag")}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Suspense fallback={null}>
          <WalletPill />
        </Suspense>
        <JobsTray />
        <CommandK />
      </div>
    </header>
  );
}
