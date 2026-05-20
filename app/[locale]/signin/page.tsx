import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { SignInForm } from "./SignInForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signin" });
  return {
    title: `${t("title")} · Mapsly`,
    description: t("subtitle"),
    robots: { index: false, follow: false },
  };
}

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.signin");

  return (
    <main
      style={{
        background: "var(--color-bg)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          padding: "32px 28px",
          boxShadow:
            "0 1px 2px rgba(28,25,22,.04), 0 8px 24px rgba(28,25,22,.05)",
        }}
      >
        <div
          aria-hidden
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-serif)",
            fontSize: 22,
            fontWeight: 700,
            color: "var(--color-text)",
            letterSpacing: "-0.02em",
            marginBottom: 24,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "var(--color-coral)",
              boxShadow: "0 0 12px rgba(195,85,58,.5)",
            }}
          />
          mapsly
        </div>

        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 28,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--color-text)",
            margin: 0,
          }}
        >
          {t("title")}
        </h1>

        <p
          style={{
            margin: "10px 0 24px",
            color: "var(--color-text-2)",
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          {t("subtitle")}
        </p>

        <SignInForm />

        <p
          style={{
            marginTop: 18,
            color: "var(--color-text-3)",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          {t("legal")}
        </p>
      </div>
    </main>
  );
}
