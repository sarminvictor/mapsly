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
 *
 * Fully STATIC: it reads no cookies/session and takes no per-request data, so
 * the header Suspense boundary stays build-resolvable. The portal-aware CTA was
 * removed (INC-2026-07-15-64) — a session read in this header forced a
 * per-request PPR resume whose segment ids collided with the prerendered shell
 * and white-paged the page. `/signin` already redirects a signed-in visitor to
 * their portal, so the static CTA still lands them there in one click.
 */
import { Link } from "@/i18n/navigation";

export interface V2NavLabels {
  price: string;
  signin: string;
  navAria: string;
}

export function V2NavLinks({ labels }: { labels: V2NavLabels }) {
  return (
    <nav aria-label={labels.navAria} className="fb-nav">
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
