/**
 * Agency portal layout · cool gray + indigo palette per
 * `.claude/rules/ui-ux-agency.md`.
 *
 * Strategy: scope a palette override on the outer container so child
 * surfaces using the shared `--color-bg` / `--color-text` tokens
 * automatically render in the agency look without each component having
 * to thread a `variant` prop. Indigo accents flow through
 * `--color-agency-indigo` (already in `app/globals.css`).
 *
 * Per `.claude/rules/cache-components.md` Pattern 2, the layout is a
 * SYNC shell with a Suspense'd async chrome. Auth lives in each page,
 * not the layout — that's what lets cacheComponents prerender empty.
 *
 * F.11 · global ⌘K business search trigger lives inline in the header.
 * `<CommandK />` is a client component that self-mounts its own modal +
 * global keydown listener for ⌘K / Ctrl+K — only the trigger button is
 * rendered in the header chrome.
 */

import { Suspense, type ReactNode } from "react";

import { CommandK } from "@/components/agency/CommandK";

interface LayoutParams {
  locale: string;
}

export default function AgencyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<LayoutParams>;
}) {
  return (
    <div
      style={
        {
          // Scope: override the shared palette tokens to the agency
          // (cool gray) variants within this subtree only. Descendants
          // using `var(--color-bg)` automatically render cool gray.
          ["--color-bg" as string]: "var(--color-agency-bg)",
          background: "var(--color-agency-bg)",
          color: "var(--color-text)",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
    >
      <Suspense fallback={<AgencyHeaderShell />}>
        <AgencyHeader params={params} />
      </Suspense>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}

function AgencyHeaderShell() {
  return (
    <div
      aria-hidden
      style={{
        padding: "14px 24px",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-2)",
        height: 54,
      }}
    />
  );
}

async function AgencyHeader({ params }: { params: Promise<LayoutParams> }) {
  // Resolve params for future i18n in the header (sign-out, settings).
  await params;
  return (
    <header
      style={{
        padding: "14px 24px",
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
          fontFamily: "var(--font-sans)",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--color-text)",
          letterSpacing: "-0.01em",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--color-agency-indigo)",
            boxShadow: "0 0 10px rgba(91,61,245,.45)",
          }}
        />
        mapsly
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(91,61,245,.10)",
            color: "var(--color-agency-indigo)",
            marginLeft: 4,
          }}
        >
          Agency
        </span>
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <CommandK />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-3)",
          }}
        >
          Lead workspace
        </span>
      </span>
    </header>
  );
}
