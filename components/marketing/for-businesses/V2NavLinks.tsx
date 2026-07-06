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
import type { PortalDestinationHref } from "@/lib/portal-destination";

export interface V2NavLabels {
  forBusinesses: string;
  forAgencies: string;
  price: string;
  signin: string;
  navAria: string;
}

export function V2NavLinks({
  labels,
  portalHref,
  portalLabel,
  portalExternal,
}: {
  labels: V2NavLabels;
  /** C3 · when the visitor is signed in, the server resolves their portal
   *  destination + label (plain data — no function crosses the boundary) so the
   *  header shows "Open your workspace" instead of "Sign in". */
  portalHref?: PortalDestinationHref;
  portalLabel?: string;
  portalExternal?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={labels.navAria} className="fb-nav">
      {/* In-page anchor to the pricing band — plain <a>, not a route. */}
      <a href="#pricing" className="fb-navlink">
        {labels.price}
      </a>
      {portalHref && portalLabel ? (
        // /admin lives outside next-intl pathnames — plain <a> so no locale
        // prefix is appended (which would 404). Internal → next-intl Link.
        // Checking `=== "/admin"` also narrows portalHref for the Link branch.
        portalExternal || portalHref === "/admin" ? (
          <a
            href={portalHref}
            className="fb-btn fb-btn--nav"
            data-testid="marketing-portal-cta"
          >
            {portalLabel}
          </a>
        ) : (
          <Link
            href={portalHref}
            className="fb-btn fb-btn--nav"
            data-testid="marketing-portal-cta"
          >
            {portalLabel}
          </Link>
        )
      ) : (
        <Link
          href="/signin"
          className="fb-btn fb-btn--nav"
          data-testid="marketing-signin-cta"
        >
          {labels.signin}
        </Link>
      )}
    </nav>
  );
}
