import * as React from "react";

/**
 * Pipeline · "How it works" 4-step block.
 *
 * Server component. Static numbered steps that explain the data engine.
 */

interface PipelineProps {
  t: (key: string) => string;
}

interface Step {
  num: string;
  title: string;
  desc: string;
}

export function Pipeline({ t }: PipelineProps) {
  const steps: Step[] = [
    {
      num: t("pipeline.step_1_num"),
      title: t("pipeline.step_1_title"),
      desc: t("pipeline.step_1_desc"),
    },
    {
      num: t("pipeline.step_2_num"),
      title: t("pipeline.step_2_title"),
      desc: t("pipeline.step_2_desc"),
    },
    {
      num: t("pipeline.step_3_num"),
      title: t("pipeline.step_3_title"),
      desc: t("pipeline.step_3_desc"),
    },
    {
      num: t("pipeline.step_4_num"),
      title: t("pipeline.step_4_title"),
      desc: t("pipeline.step_4_desc"),
    },
  ];

  return (
    <section
      id="how"
      aria-labelledby="pipeline-title"
      style={{
        padding: "72px 24px",
        background: "var(--color-bg-2)",
        borderTop: "1px solid var(--color-border)",
        borderBottom: "1px solid var(--color-border)",
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
            color: "var(--color-text-3)",
          }}
        >
          {t("pipeline.eyebrow")}
        </p>
        <h2
          id="pipeline-title"
          style={{
            margin: "12px auto 16px",
            maxWidth: 800,
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            textAlign: "center",
            color: "var(--color-text)",
          }}
        >
          {t("pipeline.title")}
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
          {t("pipeline.sub")}
        </p>

        <ol
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 20,
            padding: 0,
            margin: 0,
            listStyle: "none",
          }}
        >
          {steps.map((step, i) => (
            <li
              key={i}
              style={{
                padding: 24,
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  letterSpacing: "0.08em",
                  color: "var(--color-coral)",
                  marginBottom: 12,
                }}
              >
                {step.num}
              </div>
              <h3
                style={{
                  margin: "0 0 8px",
                  fontFamily: "var(--font-serif)",
                  fontSize: 22,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  letterSpacing: "-0.02em",
                  color: "var(--color-text)",
                }}
              >
                {step.title}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: "var(--color-text-2)",
                }}
              >
                {step.desc}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
