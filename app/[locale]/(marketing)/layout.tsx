/**
 * Marketing chrome layout · sync shell + async header/footer in <Suspense>.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 + INC-2026-05-21 (B.5
 * E_BLOCKING_ROUTE), async layouts that `await params` + `getTranslations`
 * trip the cacheComponents prerender check when a descendant route has
 * non-enumerated dynamic params (e.g. `/biz/[slug]`). Even though
 * `/biz/[slug]/page.tsx` wraps its body in Suspense + calls
 * `await connection()`, the parent layout's await chain runs first and
 * blocks the route's shell prerender.
 *
 * The fix: keep the outer container sync, and split the chrome (header,
 * footer) into Suspense'd async children that hold the
 * `setRequestLocale` + `getTranslations` calls. `children` (the page) is
 * passed through `<main>` synchronously, so the page's own Suspense
 * boundary controls when its body resolves.
 *
 * For static routes (e.g. `/for-agencies`, `/for-businesses`), the chrome
 * Suspense boundaries resolve synchronously at build time — no perceived
 * deferral, the route fully prerenders. For dynamic descendants
 * (`/biz/[slug]`), the chrome defers at request time while the rest of
 * the shell continues without blocking.
 *
 * Cites: INC-2026-05-21 (B.5), cache-components.md Pattern 2.
 */
import { Suspense, type ReactNode } from "react";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { getPortalDestination } from "@/lib/portal-destination";

interface LayoutParams {
  locale: string;
}

export default function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<LayoutParams>;
}) {
  // Sync shell: just inline styles + the children passthrough. Suspense
  // boundaries scope the async i18n reads to their own subtrees so the
  // layout itself never blocks a descendant route's prerender.
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
      <Suspense fallback={<MarketingHeaderShell />}>
        <MarketingHeader params={params} />
      </Suspense>

      <main style={{ flex: 1 }}>{children}</main>

      <Suspense fallback={<MarketingFooterShell />}>
        <MarketingFooter params={params} />
      </Suspense>
    </div>
  );
}

/**
 * Header skeleton · renders during dynamic shell prerender. Visual height
 * matches the resolved header to avoid CLS once translations resolve.
 */
function MarketingHeaderShell() {
  return (
    <div
      aria-hidden
      style={{
        padding: "20px 32px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-2)",
        height: 65,
      }}
    />
  );
}

/** Footer skeleton · same CLS-safety rationale as header shell. */
function MarketingFooterShell() {
  return (
    <div
      aria-hidden
      style={{
        marginTop: 64,
        padding: "32px",
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-bg-2)",
        height: 100,
      }}
    />
  );
}

async function MarketingHeader({ params }: { params: Promise<LayoutParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("marketing.footer");

  // Per-request session resolution. The header runs INSIDE a Suspense
  // boundary in this layout, so calling auth() here is safe under
  // cacheComponents · page bodies stay 'use cache'-fast, only the
  // chrome re-renders with the user's identity.
  //
  // When a user is signed in we swap the "Sign in" CTA for a
  // role-aware portal link (SMB → dashboard, agency → lists, admin
  // → dashboard placeholder). Anonymous visitors see the same
  // surface they always did.
  const session = await auth();
  const portal = session?.user?.id
    ? await getPortalDestination(session.user.id)
    : null;

  return (
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
        {portal ? (
          // /admin lives outside next-intl pathnames — use a plain
          // anchor so the locale prefix isn't appended (which would
          // 404 the link). next-intl Link won't accept undeclared
          // pathnames at compile time.
          portal.external || portal.href === "/admin" ? (
            <a
              href={portal.href}
              data-testid="marketing-portal-cta"
              style={{
                color: "#fff",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 600,
                padding: "8px 14px",
                border: "1px solid var(--color-coral)",
                borderRadius: 8,
                background: "var(--color-coral)",
              }}
            >
              {t(`portal_${portal.labelKey}`)}
            </a>
          ) : (
            <Link
              href={portal.href}
              data-testid="marketing-portal-cta"
              style={{
                color: "#fff",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 600,
                padding: "8px 14px",
                border: "1px solid var(--color-coral)",
                borderRadius: 8,
                background: "var(--color-coral)",
              }}
            >
              {t(`portal_${portal.labelKey}`)}
            </Link>
          )
        ) : (
          <Link
            href="/signin"
            data-testid="marketing-signin-cta"
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
        )}
      </nav>
    </header>
  );
}

async function MarketingFooter({ params }: { params: Promise<LayoutParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("marketing.footer");

  return (
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
          <Link
            href="/refunds"
            style={{
              color: "var(--color-text-2)",
              textDecoration: "none",
            }}
          >
            {t("refunds")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
