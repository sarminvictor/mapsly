import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "./dev.css";

import { auth } from "@/lib/auth";
import { requireAdmin, type AdminGuardResult } from "@/lib/portal-guard";

export const metadata: Metadata = {
  title: "Mapsly · build status",
  robots: { index: false, follow: false },
};

/**
 * `/dev` is an internal-only surface — Mapsly staff watch the autonomous
 * build loop here. Anyone with the URL used to see the dashboard; this
 * layout locks it to `User.role === "ADMIN"` only.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2, the default export
 * stays SYNC. The auth + role lookup lives inside a Suspense'd async
 * gate so the route group can still prerender its shell. Children
 * (the actual dev pages) are passed THROUGH the gate — when the gate
 * resolves to `not-admin` / `unauthenticated`, the children subtree
 * never renders, so the underlying queries (`getInFlightTaskRows`,
 * `getOpenPrs`, etc.) never fire.
 *
 * Per `.claude/rules/security.md` — zero information leakage: anyone who
 * isn't an ADMIN (unauthenticated OR signed-in-but-not-staff) gets a
 * plain 404, indistinguishable from a route that doesn't exist. The dev
 * surface must not confirm it exists (owner 2026-07-22).
 *
 * (dev) route group sits OUTSIDE the next-intl tree. The root <html> +
 * fonts come from app/layout.tsx; we just wrap the body in our dark-
 * theme container and the gate.
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dev-root">
      <Suspense fallback={<GateSkeleton />}>
        <DevAdminGate>{children}</DevAdminGate>
      </Suspense>
    </div>
  );
}

/**
 * Async gate · resolves the session + admin role, then either renders
 * the dev tree (children) or one of two boundary panels. The gate
 * itself does NO work beyond auth + a single Prisma role lookup, so
 * the cost on every /dev hit is one cached JWT decode + one indexed
 * findUnique.
 */
async function DevAdminGate({ children }: { children: ReactNode }) {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Fast path · session already carries `role` from the JWT callback
  // (lib/auth.ts). If it's ADMIN we skip the Prisma round-trip entirely.
  if (session?.user?.role === "ADMIN") return <>{children}</>;

  // Slow path · either no session, or session lacks `role` (legacy
  // token before the callback existed). `requireAdmin` covers both.
  const verdict: AdminGuardResult = await requireAdmin(userId);
  if (verdict.kind === "ok") return <>{children}</>;
  // Everyone else → 404. No branch reveals that /dev exists.
  notFound();
}

/* ------------------------------------------------------- panels */

function GateSkeleton() {
  return (
    <div
      aria-hidden
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--dev-fg-3, #475569)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
      }}
    >
      checking access…
    </div>
  );
}
