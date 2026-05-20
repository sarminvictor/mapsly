import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * PricingSmbCard · single SMB tier card ($29/mo) within the unified
 * /pricing page.
 *
 * Reuses copy from `for_businesses.pricing.*` (the single source of truth
 * for SMB pricing copy). Different visual treatment from the for-businesses
 * standalone page — here the card lives inside an audience-tabbed pricing
 * section so the surrounding chrome announces "for owners of one local
 * business" before the price.
 *
 * Per `.claude/rules/ui-ux-smb.md` · Maria's voice, warm cream + coral,
 * outcome over metric, single CTA. Pure server component.
 */
interface PricingSmbCardProps {
  t: (key: string) => string;
  tSmb: (key: string) => string;
}

const SMB_FEATURE_KEYS = ["f1", "f2", "f3", "f4", "f5", "f6"] as const;

export function PricingSmbCard({ t, tSmb }: PricingSmbCardProps) {
  return (
    <section
      id="smb"
      aria-labelledby="pricing-smb-title"
      style={{
        padding: "64px 24px",
        background: "var(--color-bg)",
        scrollMarginTop: 24,
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--color-coral)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              marginBottom: 10,
            }}
          >
            {t("smb_eyebrow")}
          </div>
          <h2
            id="pricing-smb-title"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(28px, 3.5vw, 40px)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              lineHeight: 1.1,
              margin: "0 0 12px",
              color: "var(--color-text)",
            }}
          >
            {t("smb_title")}
          </h2>
          <p
            style={{
              fontSize: 16,
              color: "var(--color-text-2)",
              lineHeight: 1.55,
              margin: "0 auto",
              maxWidth: 540,
            }}
          >
            {t("smb_sub")}
          </p>
        </header>

        <article
          aria-label={t("smb_card_label")}
          style={{
            padding: "44px 32px",
            borderRadius: 20,
            background:
              "linear-gradient(180deg, var(--color-bg-2) 0%, var(--color-bg-3) 100%)",
            border: "1px solid var(--color-coral)",
            boxShadow: "0 20px 56px rgba(195,85,58,.14)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 999,
              background: "var(--color-bg)",
              color: "var(--color-coral)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 20,
            }}
          >
            {tSmb("free_badge")}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              marginBottom: 24,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 64,
                fontWeight: 700,
                letterSpacing: "-0.04em",
                color: "var(--color-text)",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {tSmb("price")}
            </span>
            <span style={{ fontSize: 17, color: "var(--color-text-2)" }}>
              {tSmb("period")}
            </span>
          </div>

          <ul
            aria-label={t("includes_label")}
            style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 32px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {SMB_FEATURE_KEYS.map((f) => (
              <li
                key={f}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  fontSize: 15,
                  lineHeight: 1.5,
                  color: "var(--color-text)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flex: "0 0 18px",
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
                    marginTop: 2,
                  }}
                >
                  ✓
                </span>
                {tSmb(f)}
              </li>
            ))}
          </ul>

          <Link
            href={{
              pathname: "/signin",
              query: { intent: "smb" },
            }}
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
            {tSmb("cta_primary")}
          </Link>
        </article>
      </div>
    </section>
  );
}
