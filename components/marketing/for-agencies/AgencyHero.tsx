import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * AgencyHero · Tom's voice. Cool gray + indigo per `.claude/rules/ui-ux-agency.md`.
 *
 * Tone: numbers over adjectives ("2.1M SMBs · 74 signals · ≤7d refresh").
 * Imperative CTAs ("See 50 free leads"). No exclamation marks.
 *
 * Pure server component · no client JS · static SVG glyphs only.
 * First-load JS budget: 0 kB from this component.
 */

interface AgencyHeroProps {
  t: (key: string) => string;
}

export function AgencyHero({ t }: AgencyHeroProps) {
  const stats = [
    { num: t("hero.stat_1_num"), label: t("hero.stat_1_label") },
    { num: t("hero.stat_2_num"), label: t("hero.stat_2_label") },
    { num: t("hero.stat_3_num"), label: t("hero.stat_3_label") },
    { num: t("hero.stat_4_num"), label: t("hero.stat_4_label") },
  ];

  return (
    <section
      aria-labelledby="for-agencies-hero-title"
      style={{
        padding: "96px 24px 64px",
        background:
          "linear-gradient(180deg, var(--color-agency-bg) 0%, var(--color-bg-2) 100%)",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            border: "1px solid var(--color-border)",
            borderRadius: 999,
            background: "var(--color-bg-2)",
            color: "var(--color-text-2)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-agency-indigo)",
              boxShadow: "0 0 8px rgba(91,61,245,.5)",
            }}
          />
          {t("hero.eyebrow")}
        </div>

        <h1
          id="for-agencies-hero-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 800,
            fontSize: "clamp(40px, 6vw, 76px)",
            lineHeight: 1.02,
            letterSpacing: "-0.04em",
            color: "var(--color-text)",
            margin: "0 0 20px",
            maxWidth: 920,
          }}
        >
          {t("hero.title_lead")}{" "}
          <span style={{ color: "var(--color-agency-indigo)" }}>
            {t("hero.title_emph")}
          </span>{" "}
          <span style={{ color: "var(--color-text-2)" }}>
            {t("hero.title_trail")}
          </span>
        </h1>

        <p
          style={{
            fontSize: "clamp(17px, 1.7vw, 20px)",
            lineHeight: 1.55,
            color: "var(--color-text-2)",
            maxWidth: 720,
            margin: "0 0 32px",
          }}
        >
          {t("hero.sub")}
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 56,
          }}
        >
          <Link
            href="/signin"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "14px 24px",
              borderRadius: 10,
              background: "var(--color-agency-indigo)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              textDecoration: "none",
              boxShadow: "0 6px 20px rgba(91,61,245,.25)",
            }}
          >
            {t("hero.cta_primary")}
          </Link>
          <a
            href="#signals"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "14px 24px",
              borderRadius: 10,
              background: "var(--color-bg-2)",
              color: "var(--color-text)",
              fontWeight: 600,
              fontSize: 15,
              textDecoration: "none",
              border: "1px solid var(--color-border)",
            }}
          >
            {t("hero.cta_secondary")}
          </a>
        </div>

        <dl
          aria-label={t("hero.eyebrow")}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 24,
            margin: 0,
            padding: 0,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                borderLeft: "2px solid var(--color-agency-indigo)",
                paddingLeft: 16,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <dt
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                  order: 2,
                }}
              >
                {s.label}
              </dt>
              <dd
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "var(--color-text)",
                  margin: 0,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.num}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
