import * as React from "react";

/**
 * AgencyPitch · side-by-side "old way / mapsly way" comparison.
 *
 * Server component. Static content. The comparison block makes the
 * intent-based prospecting pitch concrete in 4 head-to-head bullets.
 *
 * No icons — text-only differentiates the cards via colored ticks/X
 * for legibility at any zoom. Color is NEVER the sole signal
 * (per `.claude/rules/accessibility.md`): each row prefixes "✕" or "✓"
 * which screen readers announce.
 */

interface AgencyPitchProps {
  t: (key: string) => string;
}

interface PitchCard {
  label: string;
  variant: "old" | "new";
  points: string[];
}

export function AgencyPitch({ t }: AgencyPitchProps) {
  const cards: PitchCard[] = [
    {
      label: t("pitch.old_label"),
      variant: "old",
      points: [
        t("pitch.old_p1"),
        t("pitch.old_p2"),
        t("pitch.old_p3"),
        t("pitch.old_p4"),
      ],
    },
    {
      label: t("pitch.new_label"),
      variant: "new",
      points: [
        t("pitch.new_p1"),
        t("pitch.new_p2"),
        t("pitch.new_p3"),
        t("pitch.new_p4"),
      ],
    },
  ];

  return (
    <section
      aria-labelledby="for-agencies-pitch-title"
      style={{ padding: "80px 24px", background: "var(--color-bg-2)" }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
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
          {t("pitch.eyebrow")}
        </div>
        <h2
          id="for-agencies-pitch-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 3.5vw, 44px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.08,
            margin: "0 0 16px",
            maxWidth: 780,
            color: "var(--color-text)",
          }}
        >
          {t("pitch.title")}
        </h2>
        <p
          style={{
            fontSize: 17,
            color: "var(--color-text-2)",
            maxWidth: 720,
            margin: "0 0 48px",
            lineHeight: 1.55,
          }}
        >
          {t("pitch.sub")}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
          }}
          className="mapsly-pitch-grid"
        >
          {cards.map((card) => {
            const isNew = card.variant === "new";
            return (
              <article
                key={card.label}
                style={{
                  border: `1px solid ${isNew ? "var(--color-agency-indigo)" : "var(--color-border)"}`,
                  background: isNew
                    ? "linear-gradient(180deg, rgba(91,61,245,.04) 0%, var(--color-bg-2) 100%)"
                    : "var(--color-bg)",
                  borderRadius: 16,
                  padding: 28,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: isNew
                      ? "var(--color-agency-indigo)"
                      : "var(--color-text-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 14,
                  }}
                >
                  {card.label}
                </div>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {card.points.map((p) => (
                    <li
                      key={p}
                      style={{
                        display: "flex",
                        gap: 12,
                        fontSize: 15,
                        lineHeight: 1.5,
                        color: "var(--color-text)",
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          flex: "0 0 18px",
                          color: isNew
                            ? "var(--color-success)"
                            : "var(--color-alert)",
                          fontWeight: 700,
                        }}
                      >
                        {isNew ? "✓" : "✕"}
                      </span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </div>
      {/* Two-column on ≥800px, stack on mobile */}
      <style>{`
        @media (min-width: 800px) {
          .mapsly-pitch-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
