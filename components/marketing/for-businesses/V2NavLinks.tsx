/**
 * Marketing-v2 header nav links.
 *
 * A SERVER component. It used to be a client island so the active page could
 * get `aria-current="page"` (the yellow underline) from `usePathname`, but the
 * for-businesses/for-agencies nav entries that feature highlighted are long
 * gone — the nav now renders only the pricing link and the portal/sign-in
 * CTA, neither of which is route-dependent. The hook stayed behind and kept
 * shipping JS + a hydration root on the highest-traffic page for nothing.
 * Re-add `"use client"` only if a link here becomes route-aware again.
 *
 * Labels are resolved on the server and passed in as plain strings — no
 * function prop crosses the boundary (`.claude/rules/cache-components.md`
 * Pattern 4b).
 *
 * Fully STATIC on the server: it reads no cookies/session and takes no
 * per-request data, so the header Suspense boundary stays build-resolvable
 * (INC-2026-07-15-64 — a session read here forced a per-request PPR resume
 * whose segment ids collided with the prerendered shell and white-paged the
 * page). The signed-in "Open your workspace" swap lives in <PortalCta>, a
 * client island that fetches the session AFTER hydration — never move that
 * resolution back into a server component in this tree.
 */
import { PortalCta, type PortalCtaLabels } from "./PortalCta";

export interface V2NavLabels {
  price: string;
  /** Locale-resolved href for the pricing page, e.g. "/es/precios". Resolved
   *  by the caller with `getPathname` so this stays a plain string — importing
   *  next-intl's <Link> here would pull a CLIENT component into the header and
   *  reintroduce the hydration root the docstring above exists to prevent. */
  priceHref: string;
  navAria: string;
  cta: PortalCtaLabels;
}

export function V2NavLinks({ labels }: { labels: V2NavLabels }) {
  return (
    <nav aria-label={labels.navAria} className="fb-nav">
      {/* Routes to the standalone /pricing page (T1). Was an `#pricing`
          in-page anchor back when the pricing band was the only pricing
          surface — that anchor silently did nothing on every page except the
          homepage, /pricing included. Plain <a> with a pre-resolved localized
          href: no client Link, no hydration root. */}
      <a href={labels.priceHref} className="fb-navlink">
        {labels.price}
      </a>
      <PortalCta labels={labels.cta} />
    </nav>
  );
}
