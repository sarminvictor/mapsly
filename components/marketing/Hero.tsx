import * as React from "react";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * Hero · main landing hero with audience switcher.
 *
 * Two audience cards side-by-side (stacks on mobile). SMB card uses the warm
 * cream + coral palette (Maria's portal voice). Agency card uses cool gray +
 * indigo (Tom's portal voice). The split inside ONE hero gives a single
 * entry point that immediately signals "two audiences welcome here."
 *
 * Server component · all interactivity is via `<Link>` (no hooks, no state).
 */

interface HeroProps {
  locale: Locale;
  t: (key: string) => string;
}

export function Hero({ locale: _locale, t }: HeroProps) {
  return (
    <section
      aria-labelledby="hero-title"
      style={{
        padding: "80px 24px 56px",
        background:
          "linear-gradient(180deg, var(--color-bg) 0%, var(--color-bg-2) 100%)",
        textAlign: "center",
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
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-success)",
              boxShadow: "0 0 8px var(--color-success-2)",
            }}
          />
          {t("hero.eyebrow")}
        </div>

        <h1
          id="hero-title"
          style={{
            margin: "24px auto 16px",
            maxWidth: 880,
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(40px, 6vw, 72px)",
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            color: "var(--color-text)",
          }}
        >
          {t("hero.title_lead")}{" "}
          <span style={{ color: "var(--color-coral)" }}>
            {t("hero.title_emph")}
          </span>
        </h1>

        <p
          style={{
            margin: "0 auto 40px",
            maxWidth: 720,
            fontSize: 18,
            lineHeight: 1.55,
            color: "var(--color-text-2)",
          }}
        >
          {t("hero.sub")}
        </p>

        {/* Audience switcher · the two-card row */}
        <div
          role="group"
          aria-label={t("hero.aria_choose_audience")}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            maxWidth: 880,
            margin: "0 auto 48px",
          }}
        >
          <AudienceCard
            href="/for-businesses"
            audience="smb"
            label={t("hero.smb_card_label")}
            title={t("hero.smb_card_title")}
            sub={t("hero.smb_card_sub")}
            cta={t("hero.smb_card_cta")}
          />
          <AudienceCard
            href="/for-agencies"
            audience="agency"
            label={t("hero.agency_card_label")}
            title={t("hero.agency_card_title")}
            sub={t("hero.agency_card_sub")}
            cta={t("hero.agency_card_cta")}
          />
        </div>

        {/* Stats row */}
        <dl
          aria-label={t("hero.aria_stats")}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 24,
            maxWidth: 880,
            margin: "0 auto",
            padding: "24px 0 0",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <Stat value="74" label={t("hero.stats_signals")} />
          <Stat
            value={t("hero.stats_refresh_value")}
            label={t("hero.stats_refresh")}
          />
          <Stat
            value={t("hero.stats_sources_value")}
            label={t("hero.stats_sources")}
          />
        </dl>
      </div>
    </section>
  );
}

interface AudienceCardProps {
  href: "/for-businesses" | "/for-agencies";
  audience: "smb" | "agency";
  label: string;
  title: string;
  sub: string;
  cta: string;
}

function AudienceCard({
  href,
  audience,
  label,
  title,
  sub,
  cta,
}: AudienceCardProps) {
  const accent =
    audience === "agency" ? "var(--color-agency-indigo)" : "var(--color-coral)";
  const background =
    audience === "agency" ? "var(--color-agency-bg)" : "var(--color-bg-2)";

  return (
    <Link
      href={href}
      data-audience={audience}
      style={{
        display: "block",
        padding: 24,
        background,
        border: `1px solid var(--color-border)`,
        borderRadius: 14,
        textAlign: "left",
        textDecoration: "none",
        color: "var(--color-text)",
        transition: "transform 160ms ease, box-shadow 160ms ease",
      }}
      className="mapsly-audience-card"
    >
      <span
        style={{
          display: "inline-block",
          padding: "4px 10px",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: accent,
          background: `color-mix(in srgb, ${accent} 10%, transparent)`,
          borderRadius: 999,
          marginBottom: 12,
        }}
      >
        {label}
      </span>
      <h2
        style={{
          margin: "8px 0",
          fontFamily: "var(--font-serif)",
          fontSize: 24,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: "-0.02em",
          color: "var(--color-text)",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: "0 0 16px",
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--color-text-2)",
        }}
      >
        {sub}
      </p>
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          color: accent,
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {cta}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  // HTML5 description list: <dt> (term) precedes <dd> (description).
  // Wrapping div is allowed under the spec and lets us center each pair.
  return (
    <div style={{ textAlign: "center" }}>
      <dt
        style={{
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-text-2)",
          order: 2,
          marginTop: 4,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: "var(--color-text)",
          order: 1,
        }}
      >
        {value}
      </dd>
    </div>
  );
}
