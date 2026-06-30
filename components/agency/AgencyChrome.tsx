"use client";

/**
 * Agency portal chrome · the `.app` shell from the prototype
 * (docs/portal-prototype.html) rebuilt in React.
 *
 *   .app
 *     ├─ aside.side            — dark collapsible icon rail (#0d1020 mesh)
 *     │    ├─ .side-top         — brand logomark + rail toggle
 *     │    ├─ nav.nav           — Get leads / My research / Billing / Settings
 *     │    └─ .foot             — version
 *     └─ .main
 *          ├─ .topbar           — hamburger · breadcrumb · ⌘K · wallet · avatar
 *          └─ main#main         — the routed screen
 *
 * Styling comes entirely from the scoped `agency-portal.css` (ported
 * verbatim from the prototype, prefixed under `.agency-portal`). This
 * component only supplies the markup + the two interactive states the
 * prototype drives with JS: rail expand/collapse (persisted) and the
 * mobile off-canvas drawer.
 *
 * Server slots (wallet, jobs, cmdk) are passed in as ReactNodes so the
 * DB-reading WalletPill stays a server component while the shell is a
 * client island (rail/menu state needs the client).
 *
 * Per `.claude/rules/ui-ux-agency.md` — Tom's cool-gray/indigo, dense,
 * keyboard-first workbench. Per `.claude/rules/accessibility.md` —
 * `aria-current`, labelled nav, focus-visible (indigo ring scoped in CSS),
 * skip link, Escape closes the mobile drawer.
 */

import { useEffect, useState, type ReactNode } from "react";

import { Link, usePathname } from "@/i18n/navigation";

export interface AgencyChromeLabels {
  brand: string;
  getLeads: string;
  myResearch: string;
  billing: string;
  settings: string;
  railToggle: string;
  openMenu: string;
  skipToContent: string;
}

interface NavItem {
  key: string;
  href: "/welcome" | "/research" | "/team/billing" | "/agency-settings";
  /** Internal (non-localized) pathname prefixes that light this item. */
  match: string[];
  label: string;
  icon: ReactNode;
}

const LOGOMARK = (
  <svg viewBox="0 0 39 39" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="19.5" cy="19.5" r="19.5" fill="#000" />
    <path
      d="M8.03119 27.5316V19.1098L8 11.4055H10.5889L10.2146 17.9246H10.6201C10.8073 16.3442 11.1192 15.0445 11.5559 14.0256C12.0133 13.0067 12.5956 12.2477 13.3026 11.7486C14.0304 11.2495 14.883 11 15.8603 11C16.9416 11 17.8046 11.2807 18.4492 11.8422C19.1146 12.3828 19.5929 13.173 19.884 14.2127C20.1752 15.2317 20.2895 16.4585 20.2271 17.8934H20.6014C20.7886 16.3546 21.1005 15.0757 21.5372 14.0568C21.9947 13.0379 22.5977 12.2789 23.3463 11.7798C24.0949 11.2599 24.9787 11 25.9976 11C26.8502 11 27.5884 11.1664 28.2122 11.4991C28.8361 11.811 29.3559 12.2893 29.7718 12.9339C30.2085 13.5577 30.5308 14.3479 30.7387 15.3045C30.9467 16.261 31.0507 17.3735 31.0507 18.642V27.5316H28.181V19.0475C28.181 17.7998 28.0771 16.7809 27.8691 15.9907C27.6612 15.1797 27.3388 14.587 26.9022 14.2127C26.4863 13.8176 25.9352 13.6201 25.249 13.6201C24.3964 13.6201 23.6478 13.932 23.0032 14.5559C22.3794 15.1797 21.8907 16.0635 21.5372 17.2071C21.1837 18.3508 20.9861 19.7025 20.9446 21.2621V27.5316H18.1373V19.0786C18.1373 17.8518 18.0229 16.8328 17.7942 16.0219C17.5862 15.2109 17.2639 14.6078 16.8272 14.2127C16.4114 13.8176 15.8707 13.6201 15.2053 13.6201C14.3319 13.6201 13.5833 13.932 12.9595 14.5559C12.3356 15.1797 11.847 16.0738 11.4935 17.2383C11.14 18.382 10.932 19.7441 10.8696 21.3244V27.5316H8.03119Z"
      fill="#fff"
    />
  </svg>
);

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function buildNav(l: AgencyChromeLabels): NavItem[] {
  return [
    {
      key: "get_leads",
      href: "/welcome",
      match: ["/welcome", "/discover"],
      label: l.getLeads,
      icon: (
        <svg viewBox="0 0 24 24" {...stroke}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      ),
    },
    {
      key: "my_research",
      href: "/research",
      match: ["/research"],
      label: l.myResearch,
      icon: (
        <svg viewBox="0 0 24 24" {...stroke}>
          <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
      ),
    },
    {
      key: "billing",
      href: "/team/billing",
      match: ["/team/billing", "/usage"],
      label: l.billing,
      icon: (
        <svg viewBox="0 0 24 24" {...stroke}>
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
          <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
        </svg>
      ),
    },
    {
      key: "settings",
      href: "/agency-settings",
      match: ["/agency-settings"],
      label: l.settings,
      icon: (
        <svg viewBox="0 0 24 24" {...stroke}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V20a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 18.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V2a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 3.65a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V8a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z" />
        </svg>
      ),
    },
  ];
}

function isActive(pathname: string, item: NavItem): boolean {
  return item.match.some(
    (m) => pathname === m || pathname.startsWith(m + "/"),
  );
}

/** Breadcrumb label for the current top-level section. */
function crumbLabel(pathname: string, nav: NavItem[], fallback: string): string {
  const hit = nav.find((n) => isActive(pathname, n));
  return hit?.label ?? fallback;
}

export function AgencyChrome({
  labels,
  wallet,
  jobs,
  cmdk,
  children,
}: {
  labels: AgencyChromeLabels;
  wallet: ReactNode;
  jobs: ReactNode;
  cmdk: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const nav = buildNav(labels);

  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Restore the rail preference once on mount (deferred a tick so the
  // server-rendered collapsed shell hydrates first — no mismatch, and the
  // setState lands outside the effect body per react-hooks/set-state-in-effect).
  useEffect(() => {
    let pref = false;
    try {
      pref = localStorage.getItem("agency-rail-expanded") === "1";
    } catch {
      /* private mode — default collapsed */
    }
    const id = window.setTimeout(() => setExpanded(pref), 0);
    return () => window.clearTimeout(id);
  }, []);

  // Close the mobile drawer whenever the route changes (deferred per the
  // same lint rule).
  useEffect(() => {
    const id = window.setTimeout(() => setMobileOpen(false), 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const toggleRail = () => {
    setExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem("agency-rail-expanded", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        {labels.skipToContent}
      </a>

      {/* mobile scrim */}
      {mobileOpen ? (
        <div
          aria-hidden
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(13,16,32,.42)",
            zIndex: 39,
          }}
        />
      ) : null}

      <aside
        className={`side${expanded ? " expanded" : ""}${mobileOpen ? " open" : ""}`}
        id="side"
      >
        <div className="side-top">
          <div className="brand">
            <span className="logomark">{LOGOMARK}</span>
            <span className="txt">{labels.brand}</span>
          </div>
          <button
            className="railtoggle"
            onClick={toggleRail}
            aria-label={labels.railToggle}
            aria-expanded={expanded}
            title={labels.railToggle}
          >
            <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <nav className="nav" aria-label="Primary">
          {nav.map((item) => {
            const active = isActive(pathname, item);
            return (
              <span key={item.key} style={{ display: "contents" }}>
                {/* divider between the workspace group and account group */}
                {item.key === "billing" ? <div className="sep" /> : null}
                <Link
                  href={item.href}
                  className={active ? "active" : undefined}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                >
                  <span className="ic" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="txt">{item.label}</span>
                </Link>
              </span>
            );
          })}
        </nav>

        <div className="foot">
          <span className="txt">Mapsly</span>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div
            style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}
          >
            <button
              className="hamburger"
              aria-label={labels.openMenu}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
            >
              ☰
            </button>
            <div className="crumbs">
              <b>{crumbLabel(pathname, nav, labels.getLeads)}</b>
            </div>
          </div>
          <div className="top-right">
            {cmdk}
            {wallet}
            {jobs}
            <div className="avatar" aria-hidden="true">
              A
            </div>
          </div>
        </div>

        <main id="main" role="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
