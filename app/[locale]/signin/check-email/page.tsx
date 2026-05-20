import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.check_email" });
  return {
    title: `${t("title")} · Mapsly`,
    robots: { index: false, follow: false },
  };
}

// Fully static — no searchParams dependency. The original design read
// `?email=foo@bar` from the URL to personalize the subtitle, but under
// cacheComponents (PPR) any uncached prop crossing a Suspense boundary
// triggers serialization errors. The generic "check your inbox" subtitle
// is fine UX-wise — users just signed in, they know their email.
export default async function CheckEmailPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.check_email");

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
          maxWidth: 460,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          padding: "32px 28px",
          textAlign: "center",
          boxShadow:
            "0 1px 2px rgba(28,25,22,.04), 0 8px 24px rgba(28,25,22,.05)",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 18px",
            borderRadius: "50%",
            background: "rgba(195,85,58,.10)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="28"
            height="28"
            fill="none"
            stroke="var(--color-coral)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </div>

        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 26,
            lineHeight: 1.2,
            letterSpacing: "-0.02em",
            color: "var(--color-text)",
            margin: 0,
          }}
        >
          {t("title")}
        </h1>

        <p
          style={{
            margin: "12px 0 20px",
            color: "var(--color-text-2)",
            fontSize: 15,
            lineHeight: 1.55,
          }}
        >
          {t("subtitle", { email: "your inbox" })}
        </p>

        <a
          href="https://mail.google.com/mail/u/0/#inbox"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 44,
            padding: "0 18px",
            borderRadius: 10,
            background: "var(--color-coral)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          {t("open_gmail")}
        </a>

        <p
          style={{
            marginTop: 22,
            color: "var(--color-text-3)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {t.rich("no_email_received", {
            tryAgain: (chunks) => (
              <Link
                href="/signin"
                style={{
                  color: "var(--color-coral)",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </main>
  );
}
