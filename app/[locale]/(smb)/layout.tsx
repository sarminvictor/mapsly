/**
 * SMB portal layout · sync shell + Suspense'd async chrome.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2, async layouts that
 * await uncached request data (params, auth, getTranslations) trip
 * E_BLOCKING_ROUTE under `experimental.cacheComponents: true` when a
 * descendant route has non-enumerable dynamic params. The fix: outer
 * container stays sync; async chrome lives inside Suspense boundaries
 * so the route shell can prerender empty.
 *
 * Cream + coral palette per `.claude/rules/ui-ux-smb.md` — applied via
 * the shared CSS tokens in `app/globals.css` (Maria-facing surfaces
 * already use `--color-bg = #faf6f1`, `--color-coral`).
 *
 * Auth: the layout does NOT enforce auth — child pages do. This is
 * intentional so the cacheComponents shell can prerender; auth runs
 * inside each page's own Suspense'd async body.
 */

import { Suspense, type ReactNode } from "react";

interface LayoutParams {
  locale: string;
}

export default function SmbLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<LayoutParams>;
}) {
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
      <Suspense fallback={<SmbHeaderShell />}>
        <SmbHeader params={params} />
      </Suspense>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}

/**
 * Header skeleton · matches the resolved header height to avoid CLS.
 */
function SmbHeaderShell() {
  return (
    <div
      aria-hidden
      style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-2)",
        height: 56,
      }}
    />
  );
}

async function SmbHeader({ params }: { params: Promise<LayoutParams> }) {
  // Resolve locale even though we don't currently render translated strings
  // in the header — keeps the contract stable for future i18n additions
  // (e.g. settings link, sign-out button).
  await params;
  return (
    <header
      style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "var(--font-serif)",
          fontSize: 20,
          fontWeight: 700,
          color: "var(--color-text)",
          letterSpacing: "-0.02em",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            background: "var(--color-coral)",
            boxShadow: "0 0 10px rgba(195,85,58,.45)",
          }}
        />
        mapsly
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-3)",
        }}
      >
        Your business
      </span>
    </header>
  );
}
