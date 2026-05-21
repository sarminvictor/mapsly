/**
 * HunterMarketTarget · Step 2 of the Hunter flow.
 *
 * Form chrome for picking the target market: category + city + radius.
 * The form GETs to the same route with `?step=3` (so the URL captures
 * the selection — useful for back/forward + bookmarking + shareable
 * links). No server action yet — F.2.2 wires the live-count refresh
 * when these values change.
 *
 * Server component (renders a plain `<form method="get">`). No client
 * state needed for the scaffold.
 */

import * as React from "react";

import { Link } from "@/i18n/navigation";

export interface HunterMarketTargetLabels {
  heading: string;
  subheading: string;
  categoryLabel: string;
  categoryPlaceholder: string;
  cityLabel: string;
  cityPlaceholder: string;
  radiusLabel: string;
  radiusPlaceholder: string;
  continueCta: string;
  backCta: string;
}

export interface HunterMarketTargetProps {
  template: string | null;
  category: string | null;
  labels: HunterMarketTargetLabels;
}

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-3)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  outline: "none",
};

export function HunterMarketTarget({
  template,
  category,
  labels,
}: HunterMarketTargetProps) {
  return (
    <section
      aria-labelledby="hunter-step2-heading"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "20px 22px",
        boxShadow: "0 1px 2px rgba(15, 17, 34, .04)",
      }}
    >
      <h2
        id="hunter-step2-heading"
        style={{
          margin: "0 0 6px",
          fontSize: 16,
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        {labels.heading}
      </h2>
      <p
        style={{
          margin: "0 0 18px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
        }}
      >
        {labels.subheading}
      </p>

      {/* Plain GET form — selection lands as searchParams on the next
          page render. F.2.2 swaps in a useTransition'd action for live
          debounced match-count updates. */}
      <form
        method="get"
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1.5fr 1fr",
          gap: 14,
          alignItems: "end",
        }}
      >
        {/* Preserve template selection across navigation. */}
        {template ? (
          <input type="hidden" name="template" value={template} />
        ) : null}
        <input type="hidden" name="step" value="3" />

        <div>
          <label htmlFor="hunter-category" style={fieldLabelStyle}>
            {labels.categoryLabel}
          </label>
          <input
            id="hunter-category"
            name="category"
            type="text"
            defaultValue={category ?? ""}
            placeholder={labels.categoryPlaceholder}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="hunter-city" style={fieldLabelStyle}>
            {labels.cityLabel}
          </label>
          <input
            id="hunter-city"
            name="city"
            type="text"
            placeholder={labels.cityPlaceholder}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="hunter-radius" style={fieldLabelStyle}>
            {labels.radiusLabel}
          </label>
          <input
            id="hunter-radius"
            name="radius"
            type="number"
            min={1}
            max={500}
            defaultValue={25}
            placeholder={labels.radiusPlaceholder}
            style={inputStyle}
          />
        </div>

        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 6,
          }}
        >
          <Link
            href={{ pathname: "/hunter", query: { step: "1" } }}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--color-text-3)",
              textDecoration: "none",
            }}
          >
            {labels.backCta}
          </Link>
          <button
            type="submit"
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: "var(--color-agency-indigo)",
              color: "#fff",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {labels.continueCta}
          </button>
        </div>
      </form>
    </section>
  );
}
