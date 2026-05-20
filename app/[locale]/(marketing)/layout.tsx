import type { ReactNode } from "react";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

// Shared layout for the public marketing surface (legal pages today, full
// landing/pricing/for-* pages once B.1–B.4 land). Keeps the chrome thin so
// each page sets its own hero / metadata.
export default async function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("marketing.footer");

  return (
    <div
      style={{
        background: "var(--color-bg)",
        color: "var(--color-text)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-sans)",
      }}
    >
      <header
        style={{
          padding: "20px 32px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          aria-label="Mapsly home"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-serif)",
            fontSize: 22,
            fontWeight: 700,
            color: "var(--color-text)",
            letterSpacing: "-0.02em",
            textDecoration: "none",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "var(--color-coral)",
              boxShadow: "0 0 12px rgba(195,85,58,.5)",
            }}
          />
          mapsly
        </Link>
        <nav
          aria-label="Primary"
          style={{
            display: "flex",
            gap: 24,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/for-agencies"
            style={{
              color: "var(--color-text-2)",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {t("nav_for_agencies")}
          </Link>
          <Link
            href="/pricing"
            style={{
              color: "var(--color-text-2)",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {t("nav_pricing")}
          </Link>
          <Link
            href="/signin"
            style={{
              color: "var(--color-text)",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 600,
              padding: "8px 14px",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              background: "var(--color-bg-2)",
            }}
          >
            {t("nav_signin")}
          </Link>
        </nav>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer
        style={{
          marginTop: 64,
          padding: "32px",
          borderTop: "1px solid var(--color-border)",
          background: "var(--color-bg-2)",
          color: "var(--color-text-3)",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Year is static per INC-2026-05-19-09 — new Date() is forbidden under
              cacheComponents PPR. Bump on annual redeploy. */}
          <span>{t("copyright", { year: 2026 })}</span>
          <nav
            aria-label="Legal"
            style={{ display: "flex", gap: 24, flexWrap: "wrap" }}
          >
            <Link
              href="/privacy"
              style={{
                color: "var(--color-text-2)",
                textDecoration: "none",
              }}
            >
              {t("privacy")}
            </Link>
            <Link
              href="/terms"
              style={{
                color: "var(--color-text-2)",
                textDecoration: "none",
              }}
            >
              {t("terms")}
            </Link>
            <Link
              href="/cookies"
              style={{
                color: "var(--color-text-2)",
                textDecoration: "none",
              }}
            >
              {t("cookies")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
