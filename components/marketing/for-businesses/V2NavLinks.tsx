/**
 * Marketing-v2 header nav links.
 *
 * A SERVER component. It used to be a client island so the active page could
 * get `aria-current="page"` (the yellow underline) from `usePathname`, but the
 * for-businesses/for-agencies nav entries that feature highlighted are long
 * gone — the nav now renders only the #pricing anchor and the portal/sign-in
 * CTA, neither of which is route-dependent. The hook stayed behind and kept
 * shipping JS + a hydration root on the highest-traffic page for nothing.
 * Re-add `"use client"` only if a link here becomes route-aware again.
 *
 * Labels are resolved on the server and passed in as plain strings — no
 * function prop crosses the boundary (`.claude/rules/cache-components.md`
 * Pattern 4b).
 */
import { Link } from "@/i18n/navigation";
import type { PortalDestinationHref } from "@/lib/portal-destination";

export interface V2NavLabels {
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
