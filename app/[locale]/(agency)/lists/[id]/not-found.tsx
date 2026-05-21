/**
 * not-found.tsx for `/(agency)/lists/[id]` — server-component-safe
 * shell rendered when `getAgencyListDetailData` returns `list===null`
 * (list doesn't exist, OR list belongs to a different agency than the
 * signed-in user, OR Prisma threw).
 *
 * Per `.claude/rules/security.md`, we intentionally do NOT distinguish
 * "not-yours" from "doesn't-exist" — both render the same shell to
 * avoid leaking list-id existence across agencies.
 *
 * The page is auth'd by parent route, so anonymous visitors never
 * land here (they were redirected to `/signin` first).
 */

import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

export default async function ListDetailNotFound() {
  const t = await getTranslations("agency.list_detail.not_found");
  return (
    <section
      style={{
        maxWidth: 540,
        margin: "0 auto",
        padding: "96px 24px",
        textAlign: "center",
      }}
      data-testid="list-detail-not-found"
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
