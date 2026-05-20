import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

// Cookies Policy · public marketing page.

const CANONICAL_ORIGIN = "https://mapsly.ai";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.cookies" });
  return {
    title: `${t("title")} · Mapsly`,
    description: t("subtitle"),
    alternates: {
      canonical: `${CANONICAL_ORIGIN}/cookies`,
      languages: {
        "en-US": "/cookies",
        "es-US": "/es/cookies",
        "en-CA": "/en-ca/cookies",
        "fr-CA": "/fr/temoins",
        "x-default": "/cookies",
      },
    },
    openGraph: {
      type: "article",
      siteName: "Mapsly",
      title: t("title"),
      description: t("subtitle"),
    },
    robots: { index: true, follow: true },
  };
}

export default async function CookiesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal.cookies");
  const tShared = await getTranslations("legal.shared");

  return (
    <article
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px 32px",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <p
          style={{
            color: "var(--color-text-3)",
            fontSize: 13,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {tShared("legal_eyebrow")}
        </p>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 40,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: "8px 0 12px",
          }}
        >
          {t("title")}
        </h1>
        <p style={{ color: "var(--color-text-2)", margin: 0, fontSize: 16 }}>
          {t("subtitle")}
        </p>
        <p
          style={{
            color: "var(--color-text-3)",
            margin: "12px 0 0",
            fontSize: 13,
          }}
        >
          {tShared("effective_date", { date: t("effective_date") })}
        </p>
      </header>

      <Section heading={t("s1_heading")}>
        <p>{t("s1_p1")}</p>
      </Section>

      <Section heading={t("s2_heading")}>
        <p>{t("s2_p1")}</p>
        <h3 style={subheadingStyle}>{t("s2_essential_heading")}</h3>
        <p>{t("s2_essential_p1")}</p>
        <ul style={listStyle}>
          <li>{t("s2_essential_b1")}</li>
          <li>{t("s2_essential_b2")}</li>
          <li>{t("s2_essential_b3")}</li>
        </ul>
        <h3 style={subheadingStyle}>{t("s2_analytics_heading")}</h3>
        <p>{t("s2_analytics_p1")}</p>
        <ul style={listStyle}>
          <li>{t("s2_analytics_b1")}</li>
          <li>{t("s2_analytics_b2")}</li>
        </ul>
        <h3 style={subheadingStyle}>{t("s2_third_party_heading")}</h3>
        <p>{t("s2_third_party_p1")}</p>
      </Section>

      <Section heading={t("s3_heading")}>
        <p>{t("s3_p1")}</p>
        <p>{t("s3_p2")}</p>
      </Section>

      <Section heading={t("s4_heading")}>
        <p>{t("s4_p1")}</p>
      </Section>

      <Section heading={t("s5_heading")}>
        <p>{t("s5_p1")}</p>
        <p>
          <a href="mailto:privacy@mapsly.ai" style={linkStyle}>
            privacy@mapsly.ai
          </a>
        </p>
      </Section>
    </article>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 22,
          lineHeight: 1.2,
          letterSpacing: "-0.01em",
          margin: "0 0 12px",
        }}
      >
        {heading}
      </h2>
      <div
        style={{
          color: "var(--color-text-2)",
          fontSize: 15,
          lineHeight: 1.65,
        }}
      >
        {children}
      </div>
    </section>
  );
}

const subheadingStyle: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 16,
  fontWeight: 700,
  color: "var(--color-text)",
  margin: "16px 0 6px",
};

const listStyle: React.CSSProperties = {
  margin: "8px 0 12px",
  paddingLeft: 22,
};

const linkStyle: React.CSSProperties = {
  color: "var(--color-coral)",
  textDecoration: "underline",
};
