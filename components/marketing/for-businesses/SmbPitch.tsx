import * as React from "react";

/**
 * SmbPitch · "What you see today vs what you see with Mapsly."
 *
 * Two-column comparison. Plain English on both sides. Maria's voice — no
 * "MSI" / "CTR" / "schema". The contrast does the persuading; we don't
 * narrate it heavy-handedly.
 *
 * Pure server component.
 */
interface SmbPitchProps {
  t: (key: string) => string;
}

export function SmbPitch({ t }: SmbPitchProps) {
  const oldPoints = [
    t("pitch.old_p1"),
    t("pitch.old_p2"),
    t("pitch.old_p3"),
    t("pitch.old_p4"),
  ];
  const newPoints = [
    t("pitch.new_p1"),
    t("pitch.new_p2"),
    t("pitch.new_p3"),
    t("pitch.new_p4"),
  ];

  return (
    <section
      id="how-it-works"
      aria-labelledby="for-businesses-pitch-title"
      style={{
        padding: "96px 24px",
        background: "var(--color-bg-2)",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-coral)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          {t("pitch.eyebrow")}
        </div>

        <h2
          id="for-businesses-pitch-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(32px, 4vw, 52px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            margin: "0 auto 20px",
            color: "var(--color-text)",
            textAlign: "center",
            maxWidth: 880,
          }}
        >
          {t("pitch.title")}
        </h2>
        <p
          style={{
            fontSize: 18,
            color: "var(--color-text-2)",
            lineHeight: 1.55,
            margin: "0 auto 56px",
            maxWidth: 720,
            textAlign: "center",
          }}
        >
          {t("pitch.sub")}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 24,
          }}
        >
          <article
            style={{
              padding: "32px 28px",
              borderRadius: 16,
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-3)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 16,
              }}
            >
              {t("pitch.old_label")}
            </div>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {oldPoints.map((p, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 16,
                    lineHeight: 1.5,
                    color: "var(--color-text-2)",
                    paddingLeft: 22,
                    position: "relative",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "0.55em",
                      width: 10,
                      height: 2,
                      background: "var(--color-text-3)",
                    }}
                  />
                  {p}
                </li>
              ))}
            </ul>
          </article>

          <article
            style={{
              padding: "32px 28px",
              borderRadius: 16,
              border: "1px solid var(--color-coral)",
              background: "linear-gradient(180deg, #fff 0%, #fff7f3 100%)",
              boxShadow: "0 8px 32px rgba(195,85,58,.08)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-coral)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 16,
              }}
            >
              {t("pitch.new_label")}
            </div>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {newPoints.map((p, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 16,
                    lineHeight: 1.5,
                    color: "var(--color-text)",
                    paddingLeft: 28,
                    position: "relative",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "0.2em",
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "var(--color-coral)",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
