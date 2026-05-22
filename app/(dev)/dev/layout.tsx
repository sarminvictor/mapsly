import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import "./dev.css";

import { auth } from "@/lib/auth";
import { requireAdmin, type AdminGuardResult } from "@/lib/portal-guard";

export const metadata: Metadata = {
  title: "Mapsly · build status",
  description: "Autonomous build loop telemetry · dev.mapsly.ai",
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
 * Per `.claude/rules/security.md`:
 *   - Defence-in-depth · the gate is at the layout (one location,
 *     impossible to forget on a new /dev page).
 *   - No information leakage · non-admins see the same access-denied
 *     panel whether they're authenticated or not (modulo the sign-in
 *     CTA which is needed for the unauthenticated case).
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
  if (verdict.kind === "unauthenticated") return <SignInPrompt />;
  return <AccessDenied />;
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
          background: "var(--dev-bg-1, #0f172a)",
          color: "var(--dev-fg, #e2e8f0)",
          border: "1px solid var(--dev-border, #1e293b)",
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
            color: "var(--dev-fg-2, #94a3b8)",
          }}
        >
          dev.mapsly.ai is internal · Mapsly staff only. Sign in on the main
          site, then return here.
        </p>
        <a
          href="https://www.mapsly.ai/signin?callbackUrl=https%3A%2F%2Fdev.mapsly.ai%2F"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "10px 18px",
            borderRadius: 8,
            background: "#5b3df5",
            color: "#fff",
            fontWeight: 600,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          Open sign-in →
        </a>
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
        data-testid="dev-access-denied"
        style={{
          maxWidth: 480,
          width: "100%",
          padding: "28px 24px",
          background: "var(--dev-bg-1, #0f172a)",
          color: "var(--dev-fg, #e2e8f0)",
          border: "1px solid rgba(181,61,71,.40)",
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
            background: "rgba(181,61,71,.16)",
            color: "#ff8a96",
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
          dev.mapsly.ai is staff-only
        </h1>
        <p
          style={{
            margin: "10px 0 18px",
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--dev-fg-2, #94a3b8)",
          }}
        >
          Your account exists but isn&apos;t part of the Mapsly staff. If you
          need access for support or debugging, ping{" "}
          <a
            href="mailto:support@mapsly.ai"
            style={{ color: "#a3b8ff", textDecoration: "none" }}
          >
            support@mapsly.ai
          </a>
          .
        </p>
        <a
          href="https://www.mapsly.ai/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "8px 14px",
            borderRadius: 8,
            background: "transparent",
            color: "var(--dev-fg, #e2e8f0)",
            border: "1px solid var(--dev-border, #1e293b)",
            fontWeight: 600,
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          ← back to mapsly.ai
        </a>
      </section>
    </main>
  );
}
