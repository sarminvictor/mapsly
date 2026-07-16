"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

import { SignInShell } from "../SignInShell";

// Client component — sidesteps cacheComponents serialization quirks
// with next-intl's t.rich() render-prop pattern. Renders instantly on
// signup-redirect; no DB/SSR work needed. SignInShell is deliberately
// sync/presentational so importing it here crosses no boundary.
export default function CheckEmailPage() {
  const t = useTranslations("auth.check_email");
  const tSignin = useTranslations("auth.signin");

  return (
    <SignInShell centerCard homeLabel={tSignin("logo_home")}>
      <div aria-hidden className="si-mail">
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          fill="none"
          stroke="var(--fb-ink)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      </div>

      <h1 className="si-h1" style={{ fontSize: 26 }}>
        {t("title")}
      </h1>

      <p className="si-sub" style={{ margin: "12px 0 20px" }}>
        {t("subtitle", { email: "your inbox" })}
      </p>

      <a
        href="https://mail.google.com/mail/u/0/#inbox"
        target="_blank"
        rel="noopener noreferrer"
        className="fb-btn si-btn"
        style={{ width: "auto", minHeight: 48, fontSize: 15, marginTop: 0 }}
      >
        {t("open_gmail")}
      </a>

      <p className="si-legal" style={{ marginTop: 22, textAlign: "center" }}>
        {t("no_email_received", { tryAgain: "" }).replace(/\s*\.\s*$/, "")}{" "}
        <Link href="/signin" className="si-link">
          {t("try_again")}
        </Link>
        .
      </p>
    </SignInShell>
  );
}
