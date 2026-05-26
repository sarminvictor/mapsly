import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import "./admin.css";

import { auth } from "@/lib/auth";
import { requireAdmin, type AdminGuardResult } from "@/lib/portal-guard";
import { ToastProvider } from "@/components/admin-ui/ToastProvider";
import { ConfirmProvider } from "@/components/admin-ui/ConfirmProvider";

import { AdminSidebar } from "./AdminSidebar";

export const metadata: Metadata = {
  title: "Mapsly · admin",
  description: "Mapsly internal operations — staff only.",
  robots: { index: false, follow: false },
};

/**
 * /admin is the internal operations surface — separate from /dev (build
 * loop telemetry). Discovery, billing reconciliation, and future
 * ops-admin tools live here. Locked to `User.role === "ADMIN"` only.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2, the default
 * export stays SYNC. The auth + role lookup lives inside a Suspense'd
 * async gate so the route group can still prerender its shell. When
 * the gate resolves to `not-admin` / `unauthenticated`, the children
 * subtree never renders — underlying queries (registry reads, run
 * history) never fire for non-admins.
 *
 * Per `.claude/rules/security.md`:
 *   - Defence-in-depth · gate at the layout (one location)
 *   - No information leakage · same denied panel for non-admin and
 *     unauthenticated (unauth gets a sign-in CTA instead of "denied")
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-root">
      <Suspense fallback={<GateSkeleton />}>
        <AdminGate>{children}</AdminGate>
      </Suspense>
    </div>
  );
}

async function AdminGate({ children }: { children: ReactNode }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Fast path — JWT already carries `role`
  if (session?.user?.role === "ADMIN")
    return <AdminShell>{children}</AdminShell>;

  const verdict: AdminGuardResult = await requireAdmin(userId);
  if (verdict.kind === "ok") return <AdminShell>{children}</AdminShell>;
  if (verdict.kind === "unauthenticated") return <SignInPrompt />;
  return <AccessDenied />;
}

function AdminShell({ children }: { children: ReactNode }) {
  // Providers live inside the gate · only admins ever mount them,
  // and only after the gate has resolved (so an anonymous user never
  // sees toast/confirm state initialized).
  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="admin-shell">
          <aside className="admin-sidebar">
            <div className="admin-brand">
              <strong>Mapsly</strong> · admin
            </div>
            <AdminSidebar />
          </aside>
          <main className="admin-main">{children}</main>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function GateSkeleton() {
  return (
    <div
      aria-hidden
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--admin-fg-3, #6679a8)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
      }}
    >
      checking access…
    </div>
  );
}

function SignInPrompt() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
      }}
    >
      <section
        role="alert"
        style={{
          maxWidth: 420,
          width: "100%",
          padding: "28px 24px",
          background: "var(--admin-bg-1, #111a33)",
          color: "var(--admin-fg, #e5ecff)",
          border: "1px solid var(--admin-border, #1f2b52)",
          borderRadius: 14,
          textAlign: "center",
          fontFamily: "var(--font-sans, system-ui)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.01em" }}>
          Sign in to continue
        </h1>
        <p
          style={{
            margin: "10px 0 18px",
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--admin-fg-2, #9fb0dc)",
          }}
        >
          /admin is staff-only. Sign in on the main site, then return here.
        </p>
        <Link
          href="/signin?callbackUrl=%2Fadmin%2Fdiscovery"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "10px 18px",
            borderRadius: 8,
            background: "#6f7eff",
            color: "#0b0c1e",
            fontWeight: 600,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          Open sign-in →
        </Link>
      </section>
    </main>
  );
}

function AccessDenied() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
      }}
    >
      <section
        role="alert"
        data-testid="admin-access-denied"
        style={{
          maxWidth: 480,
          width: "100%",
          padding: "28px 24px",
          background: "var(--admin-bg-1, #111a33)",
          color: "var(--admin-fg, #e5ecff)",
          border: "1px solid rgba(248,113,113,.40)",
          borderRadius: 14,
          textAlign: "center",
          fontFamily: "var(--font-sans, system-ui)",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            padding: "2px 10px",
            background: "rgba(248,113,113,.16)",
            color: "#f87171",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            borderRadius: 4,
            marginBottom: 12,
          }}
        >
          Restricted
        </span>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.01em" }}>
          /admin is staff-only
        </h1>
        <p
          style={{
            margin: "10px 0 18px",
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--admin-fg-2, #9fb0dc)",
          }}
        >
          Your account exists but isn&apos;t part of the Mapsly staff. Ping{" "}
          <a
            href="mailto:support@mapsly.ai"
            style={{ color: "#a3b4ff", textDecoration: "none" }}
          >
            support@mapsly.ai
          </a>{" "}
          if you need access.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "8px 14px",
            borderRadius: 8,
            background: "transparent",
            color: "var(--admin-fg, #e5ecff)",
            border: "1px solid var(--admin-border, #1f2b52)",
            fontWeight: 600,
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          ← back to mapsly.ai
        </Link>
      </section>
    </main>
  );
}
