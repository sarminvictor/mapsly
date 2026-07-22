import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "./admin.css";

import { auth } from "@/lib/auth";
import { requireAdmin, type AdminGuardResult } from "@/lib/portal-guard";
import { ToastProvider } from "@/components/admin-ui/ToastProvider";
import { ConfirmProvider } from "@/components/admin-ui/ConfirmProvider";

import { AdminSidebar } from "./AdminSidebar";

export const metadata: Metadata = {
  title: "Mapsly · admin",
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
 * the gate resolves to non-admin, the children subtree never renders —
 * underlying queries (registry reads, run history) never fire.
 *
 * Per `.claude/rules/security.md` — zero information leakage: anyone who
 * isn't an ADMIN (unauthenticated OR signed-in-but-not-staff) gets a
 * plain 404, indistinguishable from a route that doesn't exist. No
 * "restricted" panel, no "your account exists", no support address, no
 * sign-in hint — the admin surface must not confirm it exists. (Owner
 * 2026-07-22: the single admin signs in on the main site first.)
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
  // Everyone else → 404. No branch reveals that /admin exists.
  notFound();
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
