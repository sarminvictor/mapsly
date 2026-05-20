import * as React from "react";

/**
 * PricingHero · top band introducing the two pricing tracks.
 *
 * Audience-neutral (both Maria + Tom land here). Uses the "Mapsly black"
 * brand color rather than the SMB coral or Agency indigo — neither audience
 * is favored. Page jump-links are surfaced so visitors who already know
 * their audience can skip the intro paragraph.
 *
 * Pure server component. Mobile-first (380px target).
 */
interface PricingHeroProps {
  t: (key: string) => string;
}

export function PricingHero({ t }: PricingHeroProps) {
  return (
    <section
      aria-labelledby="pricing-hero-title"
      style={{
        padding: "96px 24px 48px",
        background:
          "linear-gradient(180deg, var(--color-bg-2) 0%, var(--color-bg) 100%)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            marginBottom: 16,
          }}
        >
          {t("hero.eyebrow")}
        </div>
        <h1
          id="pricing-hero-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(36px, 5vw, 64px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            margin: "0 0 20px",
            color: "var(--color-text)",
          }}
        >
          {t("hero.title")}
        </h1>
        <p
          style={{
            fontSize: 18,
            color: "var(--color-text-2)",
            lineHeight: 1.55,
            margin: "0 auto 32px",
            maxWidth: 600,
          }}
        >
          {t("hero.sub")}
        </p>

        <nav
          aria-label={t("hero.jump_label")}
          style={{
            display: "inline-flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <a
            href="#smb"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 999,
              background: "var(--color-bg-2)",
              color: "var(--color-coral)",
              fontWeight: 600,
              fontSize: 14,
              textDecoration: "none",
              border: "1px solid var(--color-coral)",
              minHeight: 44,
            }}
          >
            <span aria-hidden style={{ fontSize: 16 }}>
              ↓
            </span>
            {t("hero.jump_smb")}
          </a>
          <a
            href="#agency"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              borderRadius: 999,
              background: "var(--color-bg-2)",
              color: "var(--color-agency-indigo)",
              fontWeight: 600,
              fontSize: 14,
              textDecoration: "none",
              border: "1px solid var(--color-agency-indigo)",
              minHeight: 44,
            }}
          >
            <span aria-hidden style={{ fontSize: 16 }}>
              ↓
            </span>
            {t("hero.jump_agency")}
          </a>
        </nav>
      </div>
    </section>
  );
}
