import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * FinalCTA · the closing audience-split band.
 *
 * Two CTAs side-by-side. Primary (SMB) coral. Ghost-style secondary (agency).
 * Server-rendered.
 */

interface FinalCTAProps {
  t: (key: string) => string;
}

export function FinalCTA({ t }: FinalCTAProps) {
  return (
    <section
      aria-labelledby="cta-title"
      style={{
        padding: "80px 24px",
        background: "var(--color-bg-2)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div
        style={{
          maxWidth: 800,
          margin: "0 auto",
          textAlign: "center",
          padding: "48px 32px",
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
        }}
      >
        <h2
          id="cta-title"
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--color-text)",
          }}
        >
          {t("cta.title")}
        </h2>
        <p
          style={{
            margin: "12px 0 32px",
            fontSize: 16,
            lineHeight: 1.55,
            color: "var(--color-text-2)",
          }}
        >
          {t("cta.sub")}
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <Link
            href="/for-businesses"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 24px",
              background: "var(--color-coral)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              borderRadius: 10,
              textDecoration: "none",
            }}
          >
            {t("cta.smb_cta")}
            <CTAArrow />
          </Link>
          <Link
            href="/for-agencies"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 24px",
              background: "transparent",
              color: "var(--color-agency-indigo)",
              border: `1px solid var(--color-border)`,
              fontWeight: 600,
              fontSize: 15,
              borderRadius: 10,
              textDecoration: "none",
            }}
          >
            {t("cta.agency_cta")}
            <CTAArrow />
          </Link>
        </div>
      </div>
    </section>
  );
}

function CTAArrow() {
  return (
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
  );
}
