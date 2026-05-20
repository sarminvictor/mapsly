import * as React from "react";

/**
 * SignalsPreview · "Not metrics. Plain English." 6-card grid.
 *
 * Concrete examples of the named diagnoses Mapsly surfaces. The point is
 * showing that signals are sentences, not numbers. Each card has a label,
 * a status pill (good/warn/bad), a hero value, and a one-line description.
 *
 * Server component. Static content.
 */

interface SignalsPreviewProps {
  t: (key: string) => string;
}

type Tone = "bad" | "warn" | "good";

interface SignalCardData {
  label: string;
  pill: string;
  pillTone: Tone;
  value: string;
  unit: string;
  desc: string;
  barPct: number;
}

export function SignalsPreview({ t }: SignalsPreviewProps) {
  const cards: SignalCardData[] = [
    {
      label: t("signals.c1_label"),
      pill: t("signals.c1_pill"),
      pillTone: "bad",
      value: t("signals.c1_value"),
      unit: t("signals.c1_unit"),
      desc: t("signals.c1_desc"),
      barPct: 74,
    },
    {
      label: t("signals.c2_label"),
      pill: t("signals.c2_pill"),
      pillTone: "warn",
      value: t("signals.c2_value"),
      unit: t("signals.c2_unit"),
      desc: t("signals.c2_desc"),
      barPct: 62,
    },
    {
      label: t("signals.c3_label"),
      pill: t("signals.c3_pill"),
      pillTone: "bad",
      value: t("signals.c3_value"),
      unit: t("signals.c3_unit"),
      desc: t("signals.c3_desc"),
      barPct: 23,
    },
    {
      label: t("signals.c4_label"),
      pill: t("signals.c4_pill"),
      pillTone: "warn",
      value: t("signals.c4_value"),
      unit: t("signals.c4_unit"),
      desc: t("signals.c4_desc"),
      barPct: 55,
    },
    {
      label: t("signals.c5_label"),
      pill: t("signals.c5_pill"),
      pillTone: "good",
      value: t("signals.c5_value"),
      unit: t("signals.c5_unit"),
      desc: t("signals.c5_desc"),
      barPct: 19,
    },
    {
      label: t("signals.c6_label"),
      pill: t("signals.c6_pill"),
      pillTone: "bad",
      value: t("signals.c6_value"),
      unit: t("signals.c6_unit"),
      desc: t("signals.c6_desc"),
      barPct: 80,
    },
  ];

  return (
    <section
      aria-labelledby="signals-title"
      style={{
        padding: "72px 24px",
        background: "var(--color-bg-2)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <p
          style={{
            textAlign: "center",
            margin: 0,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-2)",
          }}
        >
          {t("signals.eyebrow")}
        </p>
        <h2
          id="signals-title"
          style={{
            margin: "12px auto 16px",
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            textAlign: "center",
            color: "var(--color-text)",
          }}
        >
          {t("signals.title")}
        </h2>
        <p
          style={{
            margin: "0 auto 48px",
            maxWidth: 680,
            fontSize: 16,
            lineHeight: 1.55,
            color: "var(--color-text-2)",
            textAlign: "center",
          }}
        >
          {t("signals.sub")}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {cards.map((card, i) => (
            <SignalCard key={i} card={card} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SignalCard({ card }: { card: SignalCardData }) {
  const toneColor: Record<Tone, string> = {
    bad: "var(--color-alert)",
    warn: "var(--color-gold)",
    good: "var(--color-success)",
  };
  const color = toneColor[card.pillTone];

  return (
    <article
      style={{
        padding: 20,
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-text)",
          }}
        >
          {card.label}
        </span>
        <span
          style={{
            padding: "2px 8px",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            borderRadius: 999,
          }}
        >
          {card.pill}
        </span>
      </div>

      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 36,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          color: "var(--color-text)",
          marginBottom: 8,
        }}
      >
        {card.value}
        <span
          style={{
            marginLeft: 6,
            fontSize: 14,
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            color: "var(--color-text-2)",
          }}
        >
          {card.unit}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={card.barPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={card.label}
        style={{
          height: 4,
          width: "100%",
          background: "var(--color-bg-3)",
          borderRadius: 999,
          overflow: "hidden",
          margin: "12px 0",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${card.barPct}%`,
            background: color,
            borderRadius: 999,
          }}
        />
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--color-text-2)",
        }}
      >
        {card.desc}
      </p>
    </article>
  );
}
