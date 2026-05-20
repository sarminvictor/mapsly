"use client";

import * as React from "react";
import { useId, useMemo, useState } from "react";

/**
 * AgencyCalculator · interactive sizing widget.
 *
 * "How many qualified leads in your metro?" Picks a vertical + metro tier;
 * computes a deterministic-but-illustrative count based on a static lookup
 * table baked in below. Keeps client JS tiny (~3 kB gzipped — just React
 * hooks + a small lookup) per `.claude/rules/performance.md`.
 *
 * Per `.claude/rules/cache-components.md` Pattern 4: client component because
 * it uses useState/useId. No t.rich render-prop concerns here.
 *
 * Accessibility per `.claude/rules/accessibility.md`:
 *   - <label htmlFor> on every select
 *   - aria-live="polite" on the result for screen-reader announcement
 *   - Both selects use native <select>, fully keyboard-navigable
 */

interface AgencyCalculatorProps {
  t: (key: string) => string;
}

type VerticalKey =
  | "med_spa"
  | "hvac"
  | "dental"
  | "real_estate"
  | "auto_repair"
  | "law_firm";

type MetroTier = "tier_1" | "tier_2" | "tier_3" | "tier_4";

// Illustrative lookup. Numbers are realistic for the filter set described
// in the eyebrow ("reply_rate<30 + LCP<60 + no Meta ads"). Source: 2025-11
// internal back-test snapshot. Rounded to nearest 5 for readability.
const COUNTS: Record<VerticalKey, Record<MetroTier, number>> = {
  med_spa: { tier_1: 215, tier_2: 140, tier_3: 70, tier_4: 30 },
  hvac: { tier_1: 380, tier_2: 240, tier_3: 130, tier_4: 55 },
  dental: { tier_1: 295, tier_2: 195, tier_3: 110, tier_4: 50 },
  real_estate: { tier_1: 470, tier_2: 320, tier_3: 175, tier_4: 70 },
  auto_repair: { tier_1: 410, tier_2: 280, tier_3: 155, tier_4: 65 },
  law_firm: { tier_1: 365, tier_2: 235, tier_3: 125, tier_4: 50 },
};

const VERTICALS: VerticalKey[] = [
  "med_spa",
  "hvac",
  "dental",
  "real_estate",
  "auto_repair",
  "law_firm",
];

const TIERS: MetroTier[] = ["tier_1", "tier_2", "tier_3", "tier_4"];

export function AgencyCalculator({ t }: AgencyCalculatorProps) {
  const verticalId = useId();
  const metroId = useId();
  const resultId = useId();

  const [vertical, setVertical] = useState<VerticalKey>("med_spa");
  const [tier, setTier] = useState<MetroTier>("tier_2");

  const count = useMemo(() => COUNTS[vertical][tier], [vertical, tier]);
  // Format with thousands sep using en-US (locale-specific number polish
  // is handled by the surrounding next-intl page-level provider for the
  // unit/result-lead copy; this number is purely numeric).
  const formattedCount = useMemo(
    () => new Intl.NumberFormat("en-US").format(count),
    [count],
  );

  return (
    <section
      aria-labelledby="for-agencies-calc-title"
      style={{ padding: "80px 24px", background: "var(--color-bg)" }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-agency-indigo)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginBottom: 16,
          }}
        >
          {t("calculator.eyebrow")}
        </div>
        <h2
          id="for-agencies-calc-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 3.5vw, 44px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.08,
            margin: "0 0 16px",
            color: "var(--color-text)",
          }}
        >
          {t("calculator.title")}
        </h2>
        <p
          style={{
            fontSize: 16,
            color: "var(--color-text-2)",
            margin: "0 0 32px",
            lineHeight: 1.55,
            maxWidth: 720,
            fontFamily: "var(--font-mono)",
          }}
        >
          {t("calculator.sub")}
        </p>

        <div
          style={{
            borderRadius: 16,
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-2)",
            padding: 28,
            display: "grid",
            gap: 20,
            gridTemplateColumns: "1fr",
          }}
        >
          <div
            className="mapsly-calc-row"
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: "1fr",
            }}
          >
            <div>
              <label
                htmlFor={verticalId}
                style={{
                  display: "block",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--color-text-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                }}
              >
                {t("calculator.vertical_label")}
              </label>
              <select
                id={verticalId}
                value={vertical}
                onChange={(e) => setVertical(e.target.value as VerticalKey)}
                aria-controls={resultId}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 15,
                  minHeight: 44,
                }}
              >
                {VERTICALS.map((v) => (
                  <option key={v} value={v}>
                    {t(`calculator.vertical_${v}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={metroId}
                style={{
                  display: "block",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--color-text-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                }}
              >
                {t("calculator.metro_label")}
              </label>
              <select
                id={metroId}
                value={tier}
                onChange={(e) => setTier(e.target.value as MetroTier)}
                aria-controls={resultId}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 15,
                  minHeight: 44,
                }}
              >
                {TIERS.map((m) => (
                  <option key={m} value={m}>
                    {t(`calculator.metro_${m}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            id={resultId}
            aria-live="polite"
            aria-atomic="true"
            style={{
              borderTop: "1px solid var(--color-border)",
              paddingTop: 20,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 13,
                color: "var(--color-text-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {t("calculator.result_lead")}
            </span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 52,
                  fontWeight: 800,
                  color: "var(--color-agency-indigo)",
                  letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {formattedCount}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 14,
                  color: "var(--color-text-2)",
                }}
              >
                {t("calculator.result_unit")}
              </span>
            </span>
            <span
              style={{
                marginTop: 8,
                fontSize: 13,
                color: "var(--color-text-3)",
                lineHeight: 1.5,
                fontFamily: "var(--font-mono)",
              }}
            >
              {t("calculator.result_caveat")}
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 600px) {
          .mapsly-calc-row {
            grid-template-columns: 1fr 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
