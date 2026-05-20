import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * SmbHero · Maria's voice. Warm cream + coral per `.claude/rules/ui-ux-smb.md`.
 *
 * Tone: outcome-first ("See the customers you're losing this month"), plain
 * English (no jargon), one primary CTA. Hero pill anchors weekly-refresh
 * trust without mentioning data sources.
 *
 * 4 stat tiles below the headline — strict mobile-first cap per
 * "no information density beyond 4 KPIs above the fold" (Maria audience rule).
 *
 * Pure server component · zero client JS · inline SVG glyphs only.
 */
interface SmbHeroProps {
  t: (key: string) => string;
}

export function SmbHero({ t }: SmbHeroProps) {
  const stats = [
    { num: t("hero.stat_1_num"), label: t("hero.stat_1_label") },
    { num: t("hero.stat_2_num"), label: t("hero.stat_2_label") },
    { num: t("hero.stat_3_num"), label: t("hero.stat_3_label") },
    { num: t("hero.stat_4_num"), label: t("hero.stat_4_label") },
  ];

  return (
    <section
      aria-labelledby="for-businesses-hero-title"
      style={{
        padding: "96px 24px 64px",
        background:
          "linear-gradient(180deg, var(--color-bg) 0%, var(--color-bg-2) 100%)",
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
              background: "var(--color-coral)",
              boxShadow: "0 0 8px rgba(195,85,58,.5)",
            }}
          />
          {t("hero.eyebrow")}
        </div>

        <h1
          id="for-businesses-hero-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 700,
            fontSize: "clamp(40px, 6vw, 72px)",
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            color: "var(--color-text)",
            margin: "0 0 20px",
            maxWidth: 900,
          }}
        >
          {t("hero.title_lead")}{" "}
          <span style={{ color: "var(--color-coral)" }}>
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
              padding: "16px 28px",
              borderRadius: 10,
              background: "var(--color-coral)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              textDecoration: "none",
              boxShadow: "0 8px 24px rgba(195,85,58,.25)",
              minHeight: 44,
            }}
          >
            {t("hero.cta_primary")}
          </Link>
          <a
            href="#how-it-works"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px 28px",
              borderRadius: 10,
              background: "var(--color-bg-2)",
              color: "var(--color-text)",
              fontWeight: 600,
              fontSize: 15,
              textDecoration: "none",
              border: "1px solid var(--color-border)",
              minHeight: 44,
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
                borderLeft: "2px solid var(--color-coral)",
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
                  margin: 0,
                  fontFamily: "var(--font-serif)",
                  fontSize: "clamp(28px, 3vw, 40px)",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "var(--color-text)",
                  order: 1,
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
