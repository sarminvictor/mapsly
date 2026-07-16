"use client";

/**
 * Marketing-header CTA · "Sign in" that upgrades to "Open your workspace".
 *
 * INC-2026-07-15-64: this swap previously ran server-side (`await auth()` in
 * V2Header), which made the header Suspense boundary postpone under
 * cacheComponents/PPR — the document became two concatenated Fizz renders
 * whose segment ids collided, and $RS/$RV destroyed the page. The invariant
 * this component exists to protect: the marketing shell reads NO
 * cookies/session on the server. Session is resolved here, AFTER hydration,
 * via /api/marketing/portal-destination — a React state update, never a raw
 * DOM mutation, so it also can't disturb the streaming reveal (INC-63).
 *
 * SSR + first client render are always the "Sign in" link (no hydration
 * mismatch). Anonymous visitors — the majority — never see it change; the
 * endpoint answers { portal: null } from a JWT decode without touching the
 * DB. Any fetch failure degrades to "Sign in", which still lands a signed-in
 * user in their portal because /signin redirects authenticated visitors.
 *
 * Labels arrive pre-resolved as plain strings (cache-components.md Pattern
 * 4b) — no t() function crosses the boundary.
 */

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import type {
  PortalDestination,
  PortalDestinationLabelKey,
} from "@/lib/portal-destination";

export interface PortalCtaLabels {
  signin: string;
  portal: Record<PortalDestinationLabelKey, string>;
}

export function PortalCta({ labels }: { labels: PortalCtaLabels }) {
  const [portal, setPortal] = useState<PortalDestination | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/marketing/portal-destination", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { portal: PortalDestination | null } | null) => {
        if (d?.portal) setPortal(d.portal);
      })
      .catch(() => {
        // Degrade silently to "Sign in".
      });
    return () => controller.abort();
  }, []);

  if (!portal) {
    return (
      <Link
        href="/signin"
        className="fb-btn fb-btn--nav"
        data-testid="marketing-signin-cta"
      >
        {labels.signin}
      </Link>
    );
  }

  const label = labels.portal[portal.labelKey];

  // /admin lives outside next-intl pathnames — plain <a> so no locale prefix
  // is appended (which would 404). Internal destinations use next-intl Link.
  if (portal.external || portal.href === "/admin") {
    return (
      <a
        href={portal.href}
        className="fb-btn fb-btn--nav"
        data-testid="marketing-portal-cta"
      >
        {label}
      </a>
    );
  }

  return (
    <Link
      href={portal.href}
      className="fb-btn fb-btn--nav"
      data-testid="marketing-portal-cta"
    >
      {label}
    </Link>
  );
}
