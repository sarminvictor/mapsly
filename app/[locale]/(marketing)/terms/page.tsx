import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

// Terms of Service · public marketing page.

const CANONICAL_ORIGIN = "https://mapsly.ai";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.terms" });
  return {
    title: `${t("title")} · Mapsly`,
    description: t("subtitle"),
    alternates: {
      canonical: `${CANONICAL_ORIGIN}/terms`,
      languages: {
        "en-US": "/terms",
        "es-US": "/es/terminos",
        "en-CA": "/en-ca/terms",
        "fr-CA": "/fr/conditions",
        "x-default": "/terms",
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

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal.terms");
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
        <p>{t("s2_p2")}</p>
      </Section>

      <Section heading={t("s3_heading")}>
        <p>{t("s3_p1")}</p>
        <ul style={listStyle}>
          <li>{t("s3_b1")}</li>
          <li>{t("s3_b2")}</li>
          <li>{t("s3_b3")}</li>
          <li>{t("s3_b4")}</li>
          <li>{t("s3_b5")}</li>
        </ul>
      </Section>

      <Section heading={t("s4_heading")}>
        <p>{t("s4_p1")}</p>
        <p>{t("s4_p2")}</p>
      </Section>

      <Section heading={t("s5_heading")}>
        <p>{t("s5_p1")}</p>
        <p>{t("s5_p2")}</p>
      </Section>

      <Section heading={t("s6_heading")}>
        <p>{t("s6_p1")}</p>
      </Section>

      <Section heading={t("s7_heading")}>
        <p>{t("s7_p1")}</p>
        <p>{t("s7_p2")}</p>
      </Section>

      <Section heading={t("s8_heading")}>
        <p>{t("s8_p1")}</p>
      </Section>

      <Section heading={t("s9_heading")}>
        <p>{t("s9_p1")}</p>
      </Section>

      <Section heading={t("s10_heading")}>
        <p>{t("s10_p1")}</p>
        <p>
          <a href="mailto:legal@mapsly.ai" style={linkStyle}>
            legal@mapsly.ai
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

const listStyle: React.CSSProperties = {
  margin: "8px 0 12px",
  paddingLeft: 22,
};

const linkStyle: React.CSSProperties = {
  color: "var(--color-coral)",
  textDecoration: "underline",
};
