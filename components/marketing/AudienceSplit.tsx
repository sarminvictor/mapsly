import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * AudienceSplit · the "which side of the table" comparison block.
 *
 * Two large cards side-by-side. SMB card uses cream+coral. Agency card uses
 * cool gray + indigo. Stacks on mobile. Each card has feature list + CTA.
 *
 * Server component. CTAs use the locale-aware Link.
 */

interface AudienceSplitProps {
  t: (key: string) => string;
}

export function AudienceSplit({ t }: AudienceSplitProps) {
  const smbFeatures = [
    t("split.smb_f1"),
    t("split.smb_f2"),
    t("split.smb_f3"),
    t("split.smb_f4"),
    t("split.smb_f5"),
  ];
  const agencyFeatures = [
    t("split.agency_f1"),
    t("split.agency_f2"),
    t("split.agency_f3"),
    t("split.agency_f4"),
    t("split.agency_f5"),
  ];

  return (
    <section
      aria-labelledby="split-title"
      style={{
        padding: "72px 24px",
        background: "var(--color-bg)",
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
          {t("split.eyebrow")}
        </p>
        <h2
          id="split-title"
          style={{
            margin: "12px auto 48px",
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            textAlign: "center",
            color: "var(--color-text)",
          }}
        >
          {t("split.title")}
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 24,
          }}
        >
          <AudiencePanel
            audience="smb"
            eyebrow={t("split.smb_eyebrow")}
            title={t("split.smb_title")}
            desc={t("split.smb_desc")}
            features={smbFeatures}
            ctaText={t("split.smb_cta")}
            ctaHref="/for-businesses"
          />
          <AudiencePanel
            audience="agency"
            eyebrow={t("split.agency_eyebrow")}
            title={t("split.agency_title")}
            desc={t("split.agency_desc")}
            features={agencyFeatures}
            ctaText={t("split.agency_cta")}
            ctaHref="/for-agencies"
          />
        </div>
      </div>
    </section>
  );
}

interface AudiencePanelProps {
  audience: "smb" | "agency";
  eyebrow: string;
  title: string;
  desc: string;
  features: string[];
  ctaText: string;
  ctaHref: "/for-businesses" | "/for-agencies";
}

function AudiencePanel({
  audience,
  eyebrow,
  title,
  desc,
  features,
  ctaText,
  ctaHref,
}: AudiencePanelProps) {
  const accent =
    audience === "agency" ? "var(--color-agency-indigo)" : "var(--color-coral)";
  const surface =
    audience === "agency" ? "var(--color-agency-bg)" : "var(--color-bg-2)";

  return (
    <article
      data-audience={audience}
      style={{
        padding: 32,
        background: surface,
        border: `1px solid var(--color-border)`,
        borderRadius: 16,
      }}
    >
      <p
        style={{
          margin: "0 0 8px",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: accent,
        }}
      >
        {eyebrow}
      </p>
      <h3
        style={{
          margin: "0 0 12px",
          fontFamily: "var(--font-serif)",
          fontSize: 32,
          fontWeight: 700,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          color: "var(--color-text)",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: "0 0 24px",
          fontSize: 15,
          lineHeight: 1.55,
          color: "var(--color-text-2)",
        }}
      >
        {desc}
      </p>

      <ul
        style={{
          margin: "0 0 28px",
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {features.map((feature, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              fontSize: 14,
              lineHeight: 1.5,
              color: "var(--color-text)",
            }}
          >
            <svg
              aria-hidden
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={accent}
              strokeWidth="2.5"
              style={{ flexShrink: 0, marginTop: 2 }}
            >
              <path d="M5 12l5 5L20 7" />
            </svg>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <Link
        href={ctaHref}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 20px",
          background: accent,
          color: "#fff",
          fontWeight: 600,
          fontSize: 15,
          borderRadius: 10,
          textDecoration: "none",
        }}
      >
        {ctaText}
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Link>
    </article>
  );
}
