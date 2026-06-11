"use client";

/**
 * Ad-cookie consent bar · /l only (plan #7).
 *
 * Small fixed bar at the bottom of the landing page, shown ONLY when no
 * `mapsly_consent` cookie exists. Accept OR decline writes the cookie (one
 * year) and hides the bar — a visitor who declined is never re-prompted
 * (respect the choice). After writing, a `mapsly:consent` event is dispatched
 * so an already-mounted RetargetingPixels can load without a reload.
 *
 * This gates ONLY the third-party ad pixels. The first-party
 * /api/landing-events beacon is consent-ungated by design (first-party
 * measurement, salted ipHash, no third-party sharing) — both conditional
 * third-party entries are documented on /cookies.
 *
 * State model: `useSyncExternalStore` reads "has the visitor chosen?"
 * straight from the cookie (server snapshot = chosen → SSR renders nothing,
 * no flash; the consent event is the store's change signal). A local
 * `dismissed` flag closes the bar even if the cookie write was blocked.
 *
 * Copy per SMB voice: warm, short, plain English, no exclamations.
 */

import { useState, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";

import {
  CONSENT_EVENT,
  makeConsent,
  parseConsentCookie,
  serializeConsentCookie,
} from "../consent";

const BAR: CSSProperties = {
  position: "fixed",
  insetInline: 0,
  bottom: 0,
  zIndex: 60,
  background: "var(--color-text, #2b2320)",
  color: "#fff",
  padding: "12px 20px",
  fontSize: 13.5,
  lineHeight: 1.5,
  fontFamily: "var(--font-landing-body)",
  boxShadow: "0 -8px 30px rgba(0,0,0,0.18)",
};

const BUTTON_BASE: CSSProperties = {
  minHeight: 44,
  padding: "10px 18px",
  borderRadius: 999,
  fontFamily: "var(--font-landing-body)",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
};

function subscribeConsent(onStoreChange: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, onStoreChange);
  return () => window.removeEventListener(CONSENT_EVENT, onStoreChange);
}

function hasChoiceClient(): boolean {
  try {
    return parseConsentCookie(document.cookie) != null;
  } catch {
    // Cookie access blocked — treat as chosen so the bar never traps the
    // visitor (we couldn't persist a choice anyway).
    return true;
  }
}

/** Server snapshot: pretend chosen → SSR renders nothing (no flash). */
function hasChoiceServer(): boolean {
  return true;
}

export function ConsentBar() {
  const hasChoice = useSyncExternalStore(
    subscribeConsent,
    hasChoiceClient,
    hasChoiceServer,
  );
  const [dismissed, setDismissed] = useState(false);

  if (hasChoice || dismissed) return null;

  const choose = (accepted: boolean) => {
    try {
      const consent = makeConsent(accepted);
      document.cookie = serializeConsentCookie(consent);
      window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent }));
    } catch {
      /* best-effort — a write failure must not trap the visitor in the bar */
    }
    setDismissed(true);
  };

  return (
    <div role="region" aria-label="Cookie choices" style={BAR}>
      <div
        className="landing-consent-inner"
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "10px 18px",
        }}
      >
        <p style={{ margin: 0, flex: "1 1 320px" }}>
          Okay to use a couple of ad cookies? They help us show you Mapsly
          elsewhere — nothing here changes if you say no.{" "}
          <Link
            href="/cookies"
            style={{ color: "#fff", textDecoration: "underline" }}
          >
            See what we store
          </Link>
        </p>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => choose(true)}
            style={{
              ...BUTTON_BASE,
              background: "var(--color-coral)",
              color: "#fff",
              border: "1px solid var(--color-coral)",
            }}
          >
            Allow cookies
          </button>
          <button
            type="button"
            onClick={() => choose(false)}
            style={{
              ...BUTTON_BASE,
              background: "transparent",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.5)",
            }}
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
