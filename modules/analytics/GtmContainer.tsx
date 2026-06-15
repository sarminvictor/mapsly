"use client";

/**
 * Google Tag Manager container (GTM-KZ8M3PNC) — USER pages only.
 *
 * Loaded once from the root `app/layout.tsx`, gated so GTM — and every tag
 * managed inside it (Smartlook session recording, etc.) — runs on the
 * user-facing surface (marketing, `/l` landings, SMB/agency portals, checkout)
 * and NEVER on the internal tools:
 *   - any `/admin/*` or `/dev/*` route  → GTM is not loaded
 *   - the `dev.mapsly.ai` host (any path) → GTM is not loaded
 *
 * The gate runs on first mount (reads window.location — NOT usePathname, which
 * would pull request-time data into the prerendered shell under cacheComponents
 * and break the build). GTM loads once and persists for the session, so the
 * mount check covers the real cases: a direct visit to /admin or /dev (or the
 * dev host) never loads GTM. EDGE: an admin who soft-navigates from a user page
 * INTO /admin keeps the already-loaded GTM — so ALSO exclude /admin + /dev URLs
 * in the Smartlook trigger inside the GTM console for defense-in-depth.
 *
 * Container id from NEXT_PUBLIC_GTM_ID, default GTM-KZ8M3PNC, so it ships via
 * the gitlab→Vercel deploy without a separate env change. JS loader only (no
 * <noscript> iframe) — the gating is JS-based and these tags need JS anyway.
 */

import { useEffect } from "react";

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID ?? "GTM-KZ8M3PNC";
const SAFE_GTM = /^GTM-[A-Z0-9]+$/;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Internal tools (by path) + the dev dashboard (by host) — never get GTM. */
function isInternal(pathname: string, hostname: string): boolean {
  return /^\/(admin|dev)(\/|$)/.test(pathname) || hostname.startsWith("dev.");
}

/** Standard GTM loader (idempotent — only injects once per page load). */
function loadGtm(id: string): void {
  if (document.getElementById("gtm-loader")) return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const s = document.createElement("script");
  s.id = "gtm-loader";
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${id}`;
  document.head.appendChild(s);
}

export function GtmContainer() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!SAFE_GTM.test(GTM_ID)) return;
    // Never load GTM on the internal tools / dev host.
    if (isInternal(window.location.pathname, window.location.hostname)) return;
    loadGtm(GTM_ID);
  }, []);

  return null;
}
