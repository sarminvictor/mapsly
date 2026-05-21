"use client";

/**
 * SMB portal sidebar · navigation between every Maria-facing page.
 *
 * Visible on every `/(smb)/*` route. Renders a fixed left rail on
 * desktop (≥ 900px) and collapses to a horizontal scroll-tab strip on
 * mobile so it still works under Maria's "checks the app between
 * client appointments" use case.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *
 *   - Warm cream + coral palette via the shared `--color-bg` /
 *     `--color-coral` tokens.
 *   - Sentence case labels · "Search visibility", not "SEARCH VISIBILITY".
 *   - Big tap targets (≥ 44 × 44 px) for the mobile strip.
 *   - Plain-English category labels (Daily / Watch / Account) — no
 *     marketing jargon.
 *
 * Per `.claude/rules/i18n.md` · all labels come from
 * `messages/{locale}.json` under `smb.nav.*`. The active-link rule
 * reads the canonical (non-localized) pathname via next-intl's
 * `usePathname`, so it works the same in `/dashboard` and `/panel`.
 *
 * Per `.claude/rules/accessibility.md`:
 *
 *   - `<nav aria-label>` so screen-readers announce the region.
 *   - `aria-current="page"` on the active item.
 *   - Visible focus ring (inherits from globals.css `a:focus-visible`).
 */

import { Link, usePathname } from "@/i18n/navigation";

/* ----------------------------------------------------------- types */

type NavHref =
  | "/dashboard"
  | "/reviews"
  | "/competitors"
  | "/search"
  | "/ads"
  | "/settings";

interface NavItem {
  href: NavHref;
  labelKey: keyof SmbSidebarLabels["items"];
  /** 24×24 SVG paths under stroke="currentColor" stroke-width="2". */
  icon: React.ReactNode;
}

export interface SmbSidebarLabels {
  brand: string;
  audienceTag: string;
  sections: {
    daily: string;
    watch: string;
    account: string;
  };
  items: {
    dashboard: string;
    reviews: string;
    competitors: string;
    search: string;
    ads: string;
    settings: string;
  };
}

/* ------------------------------------------------------- icon set */

const ICON_STROKE_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconDashboard() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconReviews() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
    </svg>
  );
}

function IconCompetitors() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2v20M2 12h20" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconAds() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 8h7M9 12h7M9 16h4" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/* ----------------------------------------------- nav definitions */

const DAILY_ITEMS: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: <IconDashboard /> },
  { href: "/reviews", labelKey: "reviews", icon: <IconReviews /> },
];

const WATCH_ITEMS: NavItem[] = [
  { href: "/competitors", labelKey: "competitors", icon: <IconCompetitors /> },
  { href: "/search", labelKey: "search", icon: <IconSearch /> },
  { href: "/ads", labelKey: "ads", icon: <IconAds /> },
];

const ACCOUNT_ITEMS: NavItem[] = [
  { href: "/settings", labelKey: "settings", icon: <IconSettings /> },
];

/* --------------------------------------------------- component */

export interface SmbSidebarProps {
  labels: SmbSidebarLabels;
}

export function SmbSidebar({ labels }: SmbSidebarProps) {
  const pathname = usePathname();

  function isActive(href: NavHref): boolean {
    if (href === "/dashboard") return pathname === "/dashboard";
    // `/settings/billing` should keep `/settings` highlighted.
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function renderItem(item: NavItem) {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`smb-nav-item${active ? " is-active" : ""}`}
        data-testid={`smb-nav-${item.labelKey}`}
      >
        <span aria-hidden className="smb-nav-item-icon">
          {item.icon}
        </span>
        <span>{labels.items[item.labelKey]}</span>
      </Link>
    );
  }

  return (
    <nav aria-label={labels.audienceTag} className="smb-nav">
      <div className="smb-nav-brand">
        <span aria-hidden className="smb-nav-brand-dot" />
        <span className="smb-nav-brand-text">{labels.brand}</span>
      </div>

      <div className="smb-nav-section-label">{labels.sections.daily}</div>
      {DAILY_ITEMS.map(renderItem)}

      <div className="smb-nav-section-label">{labels.sections.watch}</div>
      {WATCH_ITEMS.map(renderItem)}

      <div className="smb-nav-section-label">{labels.sections.account}</div>
      {ACCOUNT_ITEMS.map(renderItem)}
    </nav>
  );
}
