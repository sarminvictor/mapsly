"use client";

/**
 * Marketing-v2 header nav links. A tiny client island so the active page
 * gets `aria-current="page"` (the yellow underline) derived from the
 * current route — not pinned to one page. next-intl's `usePathname` returns
 * the de-localized internal pathname (e.g. "/for-agencies" on
 * /es/para-agencias), so the comparison holds across all locales.
 *
 * Labels are resolved on the server and passed in as plain strings — no
 * function prop crosses the boundary (`.claude/rules/cache-components.md`
 * Pattern 4b).
 */
import { Link, usePathname } from "@/i18n/navigation";

export interface V2NavLabels {
  forBusinesses: string;
  forAgencies: string;
  price: string;
  signin: string;
  navAria: string;
}

export function V2NavLinks({ labels }: { labels: V2NavLabels }) {
  const pathname = usePathname();

  return (
    <nav aria-label={labels.navAria} className="fb-nav">
      <Link
        href="/for-businesses"
        className="fb-navlink"
        aria-current={pathname === "/for-businesses" ? "page" : undefined}
      >
        {labels.forBusinesses}
      </Link>
      <Link
        href="/for-agencies"
        className="fb-navlink"
        aria-current={pathname === "/for-agencies" ? "page" : undefined}
      >
        {labels.forAgencies}
      </Link>
      {/* In-page anchor to the pricing band — plain <a>, not a route. */}
      <a href="#pricing" className="fb-navlink">
        {labels.price}
      </a>
      <Link
        href="/signin"
        className="fb-btn fb-btn--nav"
        data-testid="marketing-signin-cta"
      >
        {labels.signin}
      </Link>
    </nav>
  );
}
