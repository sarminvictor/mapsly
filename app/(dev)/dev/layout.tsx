import type { Metadata } from "next";
import "./dev.css";

export const metadata: Metadata = {
  title: "Mapsly · build status",
  description: "Autonomous build loop telemetry · dev.mapsly.ai",
  robots: { index: false, follow: false },
};

// The /dev route group renders 100% live, DB-backed telemetry for the
// loop supervisor + Viktor (robots: noindex). With Next 16 `cacheComponents`
// (PPR) enabled, Vercel's build worker tries to populate the static shell
// for every page in this tree — and that means opening Neon WebSocket
// connections from the build container to materialize `use cache` blocks
// for /dev, /dev/tasks, and /dev/tasks/[id]. Vercel's build sandbox can't
// hold those sockets open, every query rejects with an opaque ErrorEvent,
// and the build fails on the /dev export (breaks bundle-check + lighthouse).
//
// Force-dynamic opts the whole group out of prerender — the `use cache`
// blocks inside still cache at runtime (cacheLife("seconds") + tag
// revalidation), they just don't get pre-populated during build.
// Reason logged inline so future contributors don't re-introduce
// prerender of this internal-only tree.
export const dynamic = "force-dynamic";

// (dev) route group sits OUTSIDE the next-intl tree. The root <html> + fonts
// come from app/layout.tsx; we just wrap the body in our dark-theme container.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <div className="dev-root">{children}</div>;
}
