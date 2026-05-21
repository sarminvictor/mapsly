/**
 * not-found.tsx for `/(agency)/prospect/[businessId]` —
 * server-component-safe shell rendered when
 * `getAgencyProspectDetailData` returns `prospect===null` (business
 * doesn't exist, OR no Lead row in this user's agencies, OR Prisma
 * threw).
 *
 * Per `.claude/rules/security.md`, we intentionally do NOT distinguish
 * "not-yours" from "doesn't-exist" — both render the same shell to
 * avoid leaking business existence across agencies.
 *
 * The page is auth'd by parent route, so anonymous visitors never
 * land here (they were redirected to `/signin` first).
 */

import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

export default async function ProspectDetailNotFound() {
  const t = await getTranslations("agency.prospect_detail.not_found");
  return (
    <section
      style={{
        maxWidth: 540,
        margin: "0 auto",
        padding: "96px 24px",
        textAlign: "center",
      }}
      data-testid="prospect-detail-not-found"
    >
      <h1
        style={{
          margin: 0,
          fontSize: 26,
          fontWeight: 700,
          color: "var(--color-text)",
          letterSpacing: "-0.01em",
        }}
      >
        {t("title")}
      </h1>
      <p
        style={{
          margin: "10px 0 22px",
          fontSize: 14,
          color: "var(--color-text-2)",
          lineHeight: 1.55,
        }}
      >
        {t("body")}
      </p>
      <Link
        href={{ pathname: "/lists" }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "9px 16px",
          borderRadius: 8,
          background: "var(--color-agency-indigo)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        {t("cta")}
      </Link>
    </section>
  );
}
