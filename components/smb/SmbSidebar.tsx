"use client";

/**
 * SMB portal sidebar · navigation between every Maria-facing page.
 *
 * Visible on every `/(smb)/*` route. Two responsive forms:
 *   - Desktop (≥ 900px): a fixed 240px left rail, always open.
 *   - Mobile (< 900px):  a sticky top bar with a burger button that opens a
 *                        left-sliding drawer over a dimming scrim.
 *
 * 6 main items + Settings under "Account":
 *
 *   1. Home              · weekly overview: score, standing, fixes, market
 *   2. Reviews
 *   3. Search visibility
 *   4. Ads visibility
 *   5. Website
 *   6. My Business       · services list + business profile
 *
 *   Account section:
 *   - Settings
 *
 * Per `.claude/rules/ui-ux-smb.md`: warm cream + coral, sentence-case labels,
 * tap targets ≥ 44 × 44 px, mobile-first.
 *
 * Per `.claude/rules/accessibility.md` (mobile drawer best practices):
 *   - Burger button: `aria-label` + `aria-expanded` + `aria-controls`.
 *   - Drawer opens → focus moves inside; Tab is trapped; Escape closes;
 *     scrim click closes; selecting an item or changing route closes.
 *   - Body scroll locked while open; focus returns to the burger on close.
 *   - Closed drawer is `visibility: hidden` (CSS) so it leaves the tab order
 *     and the a11y tree on mobile.
 *   - `prefers-reduced-motion` disables the slide transition.
 *
 * Per `.claude/rules/i18n.md` · all labels come from `messages/{locale}.json`
 * under `smb.nav.*`. Active-link rule reads the canonical pathname.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Link, usePathname } from "@/i18n/navigation";

/* ----------------------------------------------------------- types */

type NavHref =
  | "/home"
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
  /** Burger button labels (open / close the mobile menu). */
  menuOpen: string;
  menuClose: string;
  sections: {
    main: string;
    account: string;
  };
  items: {
    home: string;
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

function IconBurger() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS} width={22} height={22}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg aria-hidden {...ICON_STROKE_PROPS} width={20} height={20}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/* ----------------------------------------------- nav definitions */

const MAIN_ITEMS: NavItem[] = [
  { href: "/home", labelKey: "home", icon: <IconHome /> },
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
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger (only relevant on mobile, where it exists).
    burgerRef.current?.focus();
  }, []);

  // Close the drawer on any route change (covers item taps + back/forward).
  // Adjusted during render — the React-idiomatic alternative to calling
  // setState inside an effect, so it doesn't trigger a cascading re-render.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }

  // While open: lock body scroll, move focus into the drawer, trap Tab, and
  // close on Escape. Cleanup restores scroll + listeners.
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navRef.current?.querySelector<HTMLElement>("a[href], button")?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      if (e.key !== "Tab" || !navRef.current) return;
      const focusables = Array.from(
        navRef.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])",
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeMenu]);

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
        onClick={() => setOpen(false)}
      >
        <span aria-hidden className="smb-nav-item-icon">
          {item.icon}
        </span>
        <span>{labels.items[item.labelKey]}</span>
      </Link>
    );
  }

  return (
    <>
      {/* Mobile top bar · burger + brand (hidden on desktop via CSS). */}
      <div className="smb-topbar">
        <button
          ref={burgerRef}
          type="button"
          className="smb-burger"
          aria-label={labels.menuOpen}
          aria-expanded={open}
          aria-controls="smb-nav-drawer"
          onClick={() => setOpen(true)}
        >
          <IconBurger />
        </button>
        <span className="smb-topbar-brand">
          <span aria-hidden className="smb-nav-brand-dot" />
          {labels.brand}
        </span>
      </div>

      {/* Scrim · dims the page behind the open drawer (mobile only). */}
      <div
        className={`smb-scrim${open ? " is-open" : ""}`}
        aria-hidden="true"
        onClick={closeMenu}
      />

      {/* Nav · static rail on desktop, left-sliding drawer on mobile. */}
      <nav
        id="smb-nav-drawer"
        ref={navRef}
        aria-label={labels.audienceTag}
        className={`smb-nav${open ? " is-open" : ""}`}
      >
        <div className="smb-nav-brand">
          <span aria-hidden className="smb-nav-brand-dot" />
          <span className="smb-nav-brand-text">{labels.brand}</span>
          <button
            type="button"
            className="smb-nav-close"
            aria-label={labels.menuClose}
            onClick={closeMenu}
          >
            <IconClose />
          </button>
        </div>

        <div className="smb-nav-section-label">{labels.sections.main}</div>
        {MAIN_ITEMS.map(renderItem)}

        <div className="smb-nav-section-label">{labels.sections.account}</div>
        {ACCOUNT_ITEMS.map(renderItem)}
      </nav>
    </>
  );
}
