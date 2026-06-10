"use client";

// Fires the post-payment login the moment the page mounts. Calls the server
// action DIRECTLY (not via a <form action>) — a form's server-action binding
// isn't guaranteed ready when useEffect first runs, which made an auto-
// requestSubmit() hit React's native-submit guard and silently do nothing
// (the hydration-race bug found in live testing). A direct RPC call has no such
// timing dependency. The Stripe `session_id` is the credential; on success the
// action redirects to /home, on failure to magic-link sign-in.

import { useEffect, useRef } from "react";

import { completeCheckoutLogin } from "./actions";

export function CheckoutReturnLogin({ sessionId }: { sessionId: string }) {
  const started = useRef(false);

  useEffect(() => {
    if (!sessionId || started.current) return;
    started.current = true;
    // Strip session_id from the address bar / history so a captured URL can't
    // be replayed (the value is already in hand for this call).
    window.history.replaceState(null, "", window.location.pathname);
    void completeCheckoutLogin(sessionId);
  }, [sessionId]);

  return (
    <main
      style={{
        minHeight: "70vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--font-landing-body, system-ui, sans-serif)",
        color: "var(--color-text, #2b2620)",
        background: "var(--color-bg, #faf6f1)",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div>
        <p
          style={{
            fontFamily: "var(--font-landing-head, Georgia, serif)",
            fontSize: 28,
            fontWeight: 600,
            margin: 0,
          }}
        >
          Payment received — setting up your dashboard…
        </p>
        <p style={{ marginTop: 12, color: "var(--color-text-3, #8a8175)" }}>
          One moment. You&apos;ll land on your business in a second.
        </p>
        <noscript>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- noscript fallback: <Link> needs JS; a plain anchor is the point here */}
          <a
            href="/signin?intent=smb"
            style={{
              display: "inline-block",
              marginTop: 18,
              padding: "12px 22px",
              borderRadius: 999,
              background: "var(--color-coral, #c3553a)",
              color: "#fff",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Continue to your dashboard →
          </a>
        </noscript>
      </div>
    </main>
  );
}
