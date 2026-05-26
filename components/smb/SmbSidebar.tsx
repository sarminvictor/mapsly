"use client";

/**
 * SMB portal sidebar · navigation between every Maria-facing page.
 *
 * Visible on every `/(smb)/*` route. Renders a fixed left rail on
 * desktop (≥ 900px) and collapses to a horizontal scroll-tab strip on
 * mobile so it still works under Maria's "checks the app between
 * client appointments" use case.
 *
 * 7 main items + Settings under "Account":
 *
 *   1. Home              · this week's recommendations + KPIs
 *   2. How you compare   · Mapsly Score + competitor table + medians
 *   3. Reviews
 *   4. Search visibility
 *   5. Ads visibility
 *   6. Website
 *   7. My Business       · services list + business profile
 *
 *   Account section:
 *   - Settings
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *
 *   - Warm cream + coral palette via shared `--color-bg` / `--color-coral`.
 *   - Sentence case labels.
 *   - Big tap targets (≥ 44 × 44 px) for the mobile strip.
 *   - Plain-English category labels.
 *
 * Per `.claude/rules/i18n.md` · all labels come from `messages/{locale}.json`
 * under `smb.nav.*`. The active-link rule reads the canonical (non-localized)
 * pathname via next-intl's `usePathname`.
 *
 * Per `.claude/rules/accessibility.md`:
 *
 *   - `<nav aria-label>` so screen-readers announce the region.
 *   - `aria-current="page"` on the active item.
 *   - Visible focus ring inherited from globals.css `a:focus-visible`.
 */

import { Link, usePathname } from "@/i18n/navigation";

/* ----------------------------------------------------------- types */

type NavHref =
  | "/home"
  | "/how-you-compare"
  | "/reviews"
  | "/search"
  | "/ads"
  | "/website"
  | "/my-business"
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
    main: string;
    account: string;
  };
  items: {
    home: string;
    how_you_compare: string;
    reviews: string;
    search: string;
    ads: string;
    website: string;
    my_business: string;
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

function IconHome() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function IconCompare() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="M3 20h18" />
      <rect x="5" y="10" width="3.5" height="10" rx="0.5" />
      <rect x="10.25" y="6" width="3.5" height="14" rx="0.5" />
      <rect x="15.5" y="13" width="3.5" height="7" rx="0.5" />
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

function IconWebsite() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconMyBusiness() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="M3 21V10l9-6 9 6v11" />
      <path d="M9 21v-7h6v7" />
      <path d="M3 21h18" />
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

const MAIN_ITEMS: NavItem[] = [
  { href: "/home", labelKey: "home", icon: <IconHome /> },
  {
    href: "/how-you-compare",
    labelKey: "how_you_compare",
    icon: <IconCompare />,
  },
  { href: "/reviews", labelKey: "reviews", icon: <IconReviews /> },
  { href: "/search", labelKey: "search", icon: <IconSearch /> },
  { href: "/ads", labelKey: "ads", icon: <IconAds /> },
  { href: "/website", labelKey: "website", icon: <IconWebsite /> },
  { href: "/my-business", labelKey: "my_business", icon: <IconMyBusiness /> },
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
    // `/settings/billing` should keep `/settings` highlighted; same for
    // any other nav item with sub-routes.
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

      <div className="smb-nav-section-label">{labels.sections.main}</div>
      {MAIN_ITEMS.map(renderItem)}

      <div className="smb-nav-section-label">{labels.sections.account}</div>
      {ACCOUNT_ITEMS.map(renderItem)}
    </nav>
  );
}
