/**
 * Shared style tokens for the landing sections.
 *
 * Pure constants extracted from LandingView.tsx during the per-section split —
 * every value is byte-identical to the original inline literal; this module
 * only centralizes them. The deduped constants at the bottom replace inline
 * style objects that were EXACTLY identical at two or more call sites.
 */

import type { CSSProperties } from "react";

/* ------------------------------------------------------------------ fonts */

export const SERIF = "var(--font-landing-head)";
// Body/label text uses Montserrat too (no separate monospace face) — the
// landing runs on two families only: FreightBig Pro (serif) + Montserrat (sans).

export const BODY = "var(--font-landing-body)";

/* ----------------------------------------------------------- layout tokens */

export const PAGE: CSSProperties = {
  background: "#fff",
  fontFamily: BODY,
  color: "var(--color-text)",
};

export const CONTAINER: CSSProperties = { maxWidth: 1280, margin: "0 auto" };

export const CARD: CSSProperties = {
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 18,
  padding: 24,
};

export function sectionStyle(band: "cream" | "white" | "deep"): CSSProperties {
  return {
    background:
      band === "white"
        ? "var(--color-bg-2)"
        : band === "deep"
          ? "var(--color-bg-3)"
          : "var(--color-bg)",
    padding: "clamp(56px, 8vw, 104px) 20px",
  };
}

// Shared eyebrow/label style — Montserrat SemiBold 16/32, coral, no transform.

export const EYEBROW: CSSProperties = {
  margin: 0,
  fontFamily: BODY,
  fontWeight: 600,
  fontSize: 16,
  lineHeight: "32px",
  letterSpacing: "0",
  color: "var(--color-coral)",
};

export const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontFamily: BODY,
};

/* ----------------------- deduped exact-duplicate inline style literals ---- */

/** Serif sub-heading — `margin: 0` flavor (Ads uses it twice). The 30px
 * size lives on .landing-subhead in landing.css (26px at ≤560px). */
export const SUBHEAD_30: CSSProperties = {
  margin: 0,
  fontFamily: SERIF,
  fontWeight: 700,
};

/** Centered CTA row — ScoreLine line, 18px above (Search, twice). */
export const CTA_ROW: CSSProperties = {
  marginTop: 18,
  display: "flex",
  justifyContent: "center",
};

/** Centered CTA row — pill line, 6px above (Search, twice). */
export const CTA_ROW_TIGHT: CSSProperties = {
  marginTop: 6,
  display: "flex",
  justifyContent: "center",
};

/** Stacked ScoreLine + pill grid (Website CTA block, twice). */
export const CTA_STACK: CSSProperties = {
  marginTop: 18,
  display: "grid",
  gap: 6,
  justifyItems: "center",
};

/** Inline flex row with 10px gap (Reviews table name cells, twice). */
export const ROW_FLEX_10: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
};

/** Inline star svg alignment in table cells (Reviews, twice). */
export const STAR_INLINE: CSSProperties = {
  display: "inline-block",
  verticalAlign: "-1px",
};

/** Inline up-trend arrow svg alignment (hero card + reviews score band). */
export const TREND_ARROW: CSSProperties = {
  display: "inline-block",
  verticalAlign: "-2px",
  marginRight: 4,
};

/** 15px semibold unit suffix next to a big serif stat (Search "/ mo" +
 * Website "/ 100"). */
export const STAT_UNIT_15: CSSProperties = {
  fontFamily: BODY,
  fontSize: 15,
  fontWeight: 600,
  color: "var(--color-text)",
};

/** 16px semibold unit suffix (Fixes "/ {impactSub}" + Pricing "/ mo"). */
export const STAT_UNIT_16: CSSProperties = {
  fontFamily: BODY,
  fontSize: 16,
  fontWeight: 600,
  color: "var(--color-text)",
};
