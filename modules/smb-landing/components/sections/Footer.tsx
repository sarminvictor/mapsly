/**
 * Trust footer. Exported (re-exported via LandingView) for unit tests
 * (modules/smb-landing/__tests__). Extracted verbatim from LandingView.tsx.
 */

import type { CSSProperties } from "react";
import Link from "next/link";

import { Wordmark } from "./brand";
import { CONTAINER, SERIF } from "./style-tokens";

/** Footer link · white-on-coral, subtly underlined so link-ness reads. */
const FOOTER_LINK: CSSProperties = {
  color: "rgba(255,255,255,0.78)",
  textDecoration: "underline",
  textDecorationColor: "rgba(255,255,255,0.35)",
  textUnderlineOffset: 3,
};

/** Legal links · ≥44px hit area without moving a pixel: padding grows the
 * tap box, the matching negative margin cancels the layout shift. 13px text
 * at the inherited 1.5 line-height ≈ 19.5px + 2×13px = 45.5px tall; 10px of
 * side padding stays inside the menu's 24px gap (no overlapping targets). */
const FOOTER_LEGAL_LINK: CSSProperties = {
  ...FOOTER_LINK,
  display: "inline-block",
  padding: "13px 10px",
  margin: "-13px -10px",
};

/**
 * Trust footer. Exported for unit tests (modules/smb-landing/__tests__).
 * `token` is the landing token — the removal link (/r/[token]) is keyed by it.
 * The hero's "see how" line anchors to #data-sources here.
 */
export function LandingFooter({ token }: { token: string }) {
  return (
    <footer
      className="landing-footer"
      style={{ background: "var(--color-coral)" }}
    >
      <div
        className="landing-footer-inner"
        style={{
          ...CONTAINER,
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
          <a
            href="https://www.mapsly.ai"
            aria-label="Mapsly home"
            style={{ display: "inline-flex", color: "inherit" }}
          >
            <Wordmark light />
          </a>
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 22,
              fontWeight: 700,
              color: "rgba(255,255,255,0.92)",
              whiteSpace: "nowrap",
            }}
          >
            Your business. <em style={{ fontStyle: "italic" }}>Mapped.</em>
          </span>
        </span>
        <span
          className="landing-footer-menu"
          style={{
            flexWrap: "wrap",
            fontSize: 13,
          }}
        >
          <Link href="/privacy" style={FOOTER_LEGAL_LINK}>
            Privacy
          </Link>
          <Link href="/terms" style={FOOTER_LEGAL_LINK}>
            Terms
          </Link>
          <Link href="/refunds" style={FOOTER_LEGAL_LINK}>
            Cancellation & refunds
          </Link>
        </span>
      </div>
      <div
        style={{
          ...CONTAINER,
          marginTop: 36,
          display: "grid",
          gap: 14,
          borderTop: "1px solid rgba(255,255,255,0.18)",
          paddingTop: 24,
        }}
      >
        {/* PHYSICAL ADDRESS · placeholder slot — owned by the separate
            postal-address scope. It drops the mailing-address line here
            (CAN-SPAM/CASL) above the © + provenance row. */}
        <p
          style={{
            margin: 0,
            display: "flex",
            gap: 24,
            flexWrap: "wrap",
            alignItems: "center",
            fontSize: 13,
            lineHeight: 1.6,
            color: "rgba(255,255,255,0.78)",
          }}
        >
          {/* © + data provenance merged into one continuous line (Viktor's
              improvement-plan call) — one line on desktop, natural wrap on
              narrow screens. The #data-sources id stays: the hero's "see how"
              link anchors here. Single string literal = single text node. */}
          <span id="data-sources">
            {
              "© 2026 Mapsly · Every number here comes from public sources: your Google listing, ad libraries, and your public website."
            }
          </span>
          <a
            href={`/r/${token}`}
            style={{ ...FOOTER_LINK, marginLeft: "auto", whiteSpace: "nowrap" }}
          >
            Not your business? Remove this page
          </a>
        </p>
      </div>
    </footer>
  );
}
