"use client";

/**
 * Landing-page funnel instrumentation (client).
 *
 * Fires the on-page funnel steps to `/api/landing-events`:
 *   - PAGE_OPENED      once on mount
 *   - SECTION_VIEWED   once per section as it scrolls ≥40% into view
 *   - CTA_CLICKED      on any [data-landing-cta] click (beacon, survives nav)
 *
 * CHECKOUT_OPENED is emitted by the post-signin → checkout step (server-side);
 * SUBSCRIPTION_BOUGHT by the Stripe webhook. A `visitorId` (localStorage)
 * counts unique visitors per step; a `sessionId` sequences one page-load.
 * Uses `sendBeacon` so the CTA click lands even as the page navigates away.
 * Best-effort only — every call is wrapped so analytics can never break the page.
 */

import { useEffect } from "react";

const ENDPOINT = "/api/landing-events";
const VID_KEY = "mapsly_l_vid";

type EventType = "PAGE_OPENED" | "SECTION_VIEWED" | "CTA_CLICKED";

function getVisitorId(): string {
  try {
    let v = localStorage.getItem(VID_KEY);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(VID_KEY, v);
    }
    return v;
  } catch {
    return "anon";
  }
}

function makeSender(base: {
  token: string;
  visitorId: string;
  sessionId: string;
}) {
  return (type: EventType, section?: string) => {
    try {
      const body = JSON.stringify({ ...base, type, section });
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          ENDPOINT,
          new Blob([body], { type: "application/json" }),
        );
      } else {
        void fetch(ENDPOINT, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
        });
      }
    } catch {
      /* analytics is best-effort — never throw into the page */
    }
  };
}

export function LandingAnalytics({ token }: { token: string }) {
  useEffect(() => {
    if (!token) return;
    const send = makeSender({
      token,
      visitorId: getVisitorId(),
      sessionId: crypto.randomUUID(),
    });

    send("PAGE_OPENED");

    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const sec = (e.target as HTMLElement).dataset.landingSection;
          if (sec && !seen.has(sec)) {
            seen.add(sec);
            send("SECTION_VIEWED", sec);
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.4 },
    );
    document
      .querySelectorAll("[data-landing-section]")
      .forEach((el) => io.observe(el));

    const onClick = (ev: Event) => {
      const target = ev.target as HTMLElement | null;
      const cta = target?.closest<HTMLElement>("[data-landing-cta]");
      if (cta) send("CTA_CLICKED", cta.dataset.landingCta ?? "unknown");
    };
    document.addEventListener("click", onClick, { capture: true });

    return () => {
      io.disconnect();
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, [token]);

  return null;
}
