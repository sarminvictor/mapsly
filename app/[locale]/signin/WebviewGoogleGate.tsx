"use client";

/**
 * Wraps the "Continue with Google" button and swaps it for a steer-to-email
 * notice when the page is opened inside an in-app browser (LinkedIn/Facebook/
 * Instagram/… webviews), where Google returns 403 disallowed_useragent.
 *
 * REAL BROWSERS ARE UNCHANGED. The server snapshot is always null, so SSR and
 * the hydrating client render `children` — the untouched server-rendered
 * Google button — with no mismatch. Only after hydration does the client
 * snapshot read the UA, and only a high-confidence in-app token flips it (see
 * lib/webview-detect). A normal Chrome/Safari/Firefox/Edge UA matches nothing,
 * so the button is never touched and stays in the static prerender as before.
 *
 * We use useSyncExternalStore (not useEffect+setState) because the value is a
 * one-shot client-only read: it gives the correct null-on-server → value-on-
 * client hydration without a set-state-in-effect double render. The UA is
 * constant for the session, so the snapshot is memoized to a stable reference
 * (useSyncExternalStore loops if getSnapshot returns a fresh object each call).
 *
 * The Google button (a server component with its server action) is passed as
 * `children`, so no function prop crosses the boundary (cache-components.md
 * Pattern 4). Copy is resolved via useTranslations — the same client-side i18n
 * the check-email page uses — so nothing is hardcoded and no labels are threaded.
 */

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { detectInAppBrowser, type InAppBrowser } from "@/lib/webview-detect";

let cachedInApp: InAppBrowser | null | undefined;
function clientSnapshot(): InAppBrowser | null {
  if (cachedInApp === undefined) {
    cachedInApp = detectInAppBrowser(
      typeof navigator === "undefined" ? null : navigator.userAgent,
    );
  }
  return cachedInApp;
}
const serverSnapshot = (): InAppBrowser | null => null;
const subscribe = () => () => {};

export function WebviewGoogleGate({ children }: { children: ReactNode }) {
  const t = useTranslations("auth.signin");
  const inApp = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [copied, setCopied] = useState(false);

  // Real browsers (and the server) render the normal Google button.
  if (!inApp) return <>{children}</>;

  // Escape to Safari: the current URL is same-origin (never attacker-supplied),
  // so prefixing it with the x-safari- scheme carries no open-redirect risk.
  const openInSafari = () => {
    window.location.href = `x-safari-${window.location.href}`;
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <div className="si-webview" role="note">
      <h2 className="si-webview-title">
        {t("webview_notice", { app: inApp.app })}
      </h2>
      <p className="si-webview-sub">{t("webview_sub")}</p>
      {inApp.canOpenInSafari ? (
        <button type="button" className="si-webview-btn" onClick={openInSafari}>
          {t("webview_open_safari")}
        </button>
      ) : (
        <>
          <button type="button" className="si-webview-btn" onClick={copyLink}>
            {t("webview_copy")}
          </button>
          {/* Confirmation lives in a dedicated status region, NOT via aria-live
              on the button (which would overwrite its accessible name). The
              button label stays "Copy link"; the status carries the next step
              so copy-branch users (Android, where there's no auto-open) know to
              paste + open. Persistent on purpose — the instruction stays put
              while they switch to their browser. */}
          <p className="si-webview-status" role="status">
            {copied ? t("webview_copied_hint") : ""}
          </p>
        </>
      )}
    </div>
  );
}
