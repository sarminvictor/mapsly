/**
 * SMB portal layout · sidebar + main content shell.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Cream + coral palette (`--color-bg`, `--color-coral` tokens).
 *   - Sidebar on desktop, horizontal tab strip on mobile (≤ 899px).
 *     Layout grid + media queries live in `app/globals.css`.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2, the default
 * export is SYNC; async work that awaits uncached request data
 * (params, getTranslations) lives inside a Suspense boundary so the
 * shell can prerender empty even when descendant routes have
 * non-enumerable dynamic params.
 *
 * Auth is enforced on each page — NOT in the layout — for the same
 * cacheComponents reason.
 */

import { Suspense, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { SmbSidebar, type SmbSidebarLabels } from "@/components/smb/SmbSidebar";

interface LayoutParams {
  locale: string;
}

export default function SmbLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<LayoutParams>;
}) {
  return (
    <div className="smb-shell">
      <Suspense fallback={<SmbSidebarShell />}>
        <SmbSidebarServer params={params} />
      </Suspense>
      <main style={{ minWidth: 0 }}>{children}</main>
    </div>
  );
}

/**
 * Sidebar skeleton · same width as the resolved sidebar to avoid CLS.
 * On mobile this collapses with the same media query the real nav uses.
 */
function SmbSidebarShell() {
  return <div aria-hidden className="smb-nav" style={{ minHeight: 200 }} />;
}

async function SmbSidebarServer({ params }: { params: Promise<LayoutParams> }) {
  // Resolve params so next-intl picks the right locale for getTranslations.
  await params;

  const t = await getTranslations("smb.nav");

  const labels: SmbSidebarLabels = {
    brand: t("brand"),
    audienceTag: t("audience_tag"),
    menuOpen: t("menu_open"),
    menuClose: t("menu_close"),
    sections: {
      main: t("section_main"),
      account: t("section_account"),
    },
    items: {
      home: t("item_home"),
      reviews: t("item_reviews"),
      search: t("item_search"),
      ads: t("item_ads"),
      website: t("item_website"),
      my_business: t("item_my_business"),
      settings: t("item_settings"),
    },
  };

  return <SmbSidebar labels={labels} />;
}
