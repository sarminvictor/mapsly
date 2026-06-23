"use client";

/**
 * Agency portal sidebar · keyboard-first navigation between every
 * Tom-facing page.
 *
 * Visible on every `/(agency)/*` route. Renders a fixed left rail on
 * desktop (≥ 900px) and collapses to a horizontal scroll-tab strip on
 * mobile — Tom is desktop-first but the strip keeps the portal usable
 * when he checks in from a phone.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *
 *   - Cool gray + indigo palette via the shared `--color-agency-bg` /
 *     `--color-agency-indigo` tokens.
 *   - Dense type (14px labels, 40px tap targets — 4px tighter than
 *     SMB which sets 44px for Maria).
 *   - Jargon allowed and expected · "Hunter" / "List analytics" /
 *     "Reports" all show up verbatim.
 *
 * Per `.claude/rules/i18n.md` · labels come from
 * `messages/{locale}.json` under `agency.nav.*`. Active-link detection
 * uses next-intl's `usePathname()` so `/lists` and `/listas` /
 * `/listes` all highlight the same item.
 *
 * Per `.claude/rules/accessibility.md`:
 *   - `<nav aria-label>` so screen-readers announce the region.
 *   - `aria-current="page"` on the active item.
 *   - Visible focus ring (inherits from globals.css `a:focus-visible`).
 */

import { Link, usePathname } from "@/i18n/navigation";

/* ------------------------------------------------------------ types */

type NavHref =
  | "/lists"
  | "/hunter"
  | "/discover"
  | "/campaigns"
  | "/list-analytics"
  | "/list-activity"
  | "/reports"
  | "/touchpoints"
  | "/agency-settings"
  | "/team/billing";

interface NavItem {
  href: NavHref;
  labelKey: keyof AgencySidebarLabels["items"];
  icon: React.ReactNode;
}

export interface AgencySidebarLabels {
  brand: string;
  audienceTag: string;
  sections: {
    workspace: string;
    insight: string;
    account: string;
  };
  items: {
    lists: string;
    hunter: string;
    discover: string;
    campaigns: string;
    list_analytics: string;
    list_activity: string;
    reports: string;
    touchpoints: string;
    agency_settings: string;
    team_billing: string;
  };
}

/* ----------------------------------------------------- icon set */

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

function IconLists() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function IconHunter() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconDiscover() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="m16.2 7.8-2 6.3-6.4 2.1 2-6.3z" />
    </svg>
  );
}

function IconCampaigns() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  );
}

function IconTouchpoints() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconAnalytics() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="M3 3v18h18" />
      <path d="M18 17V9M13 17v-5M8 17v-3" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function IconReports() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
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

function IconBilling() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h2M11 15h2" />
    </svg>
  );
}

/* ----------------------------------------------- nav definitions */

const WORKSPACE_ITEMS: NavItem[] = [
  { href: "/lists", labelKey: "lists", icon: <IconLists /> },
  { href: "/hunter", labelKey: "hunter", icon: <IconHunter /> },
  { href: "/discover", labelKey: "discover", icon: <IconDiscover /> },
  { href: "/campaigns", labelKey: "campaigns", icon: <IconCampaigns /> },
];

const INSIGHT_ITEMS: NavItem[] = [
  {
    href: "/list-analytics",
    labelKey: "list_analytics",
    icon: <IconAnalytics />,
  },
  {
    href: "/list-activity",
    labelKey: "list_activity",
    icon: <IconActivity />,
  },
  { href: "/reports", labelKey: "reports", icon: <IconReports /> },
  {
    href: "/touchpoints",
    labelKey: "touchpoints",
    icon: <IconTouchpoints />,
  },
];

const ACCOUNT_ITEMS: NavItem[] = [
  {
    href: "/agency-settings",
    labelKey: "agency_settings",
    icon: <IconSettings />,
  },
  { href: "/team/billing", labelKey: "team_billing", icon: <IconBilling /> },
];

/* --------------------------------------------------- component */

export interface AgencySidebarProps {
  labels: AgencySidebarLabels;
}

export function AgencySidebar({ labels }: AgencySidebarProps) {
  const pathname = usePathname();

  function isActive(href: NavHref): boolean {
    if (href === "/lists") {
      // `/lists/:id` should keep /lists highlighted.
      return pathname === "/lists" || pathname.startsWith("/lists/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function renderItem(item: NavItem) {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`agency-nav-item${active ? " is-active" : ""}`}
        data-testid={`agency-nav-${item.labelKey}`}
      >
        <span aria-hidden className="agency-nav-item-icon">
          {item.icon}
        </span>
        <span>{labels.items[item.labelKey]}</span>
      </Link>
    );
  }

  return (
    <nav aria-label={labels.audienceTag} className="agency-nav">
      <div className="agency-nav-brand">
        <span aria-hidden className="agency-nav-brand-dot" />
        <span className="agency-nav-brand-text">{labels.brand}</span>
        <span className="agency-nav-brand-tag">{labels.audienceTag}</span>
      </div>

      <div className="agency-nav-section-label">
        {labels.sections.workspace}
      </div>
      {WORKSPACE_ITEMS.map(renderItem)}

      <div className="agency-nav-section-label">{labels.sections.insight}</div>
      {INSIGHT_ITEMS.map(renderItem)}

      <div className="agency-nav-section-label">{labels.sections.account}</div>
      {ACCOUNT_ITEMS.map(renderItem)}
    </nav>
  );
}
