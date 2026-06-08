"use client";

// Auto-submits the post-payment login the moment the page mounts (no click
// needed) — the Stripe `session_id` is the credential. A <noscript> fallback
// button keeps it working without JS.

import { useEffect, useRef } from "react";

import { completeCheckoutLogin } from "./actions";

export function CheckoutReturnLogin({ sessionId }: { sessionId: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    // Strip session_id from the address bar + history so a captured URL can't be
    // replayed later (the form already holds the value for this submit).
    window.history.replaceState(null, "", window.location.pathname);
    formRef.current?.requestSubmit();
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
        <form ref={formRef} action={completeCheckoutLogin}>
          <input type="hidden" name="session_id" value={sessionId} />
          <noscript>
            <button
              type="submit"
              style={{
                marginTop: 18,
                padding: "12px 22px",
                borderRadius: 999,
                border: "none",
                background: "var(--color-coral, #c3553a)",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Continue to your dashboard →
            </button>
          </noscript>
        </form>
      </div>
    </main>
  );
}
