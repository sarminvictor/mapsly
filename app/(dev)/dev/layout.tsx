import type { Metadata } from "next";
import "./dev.css";

export const metadata: Metadata = {
  title: "Mapsly · build status",
  description: "Autonomous build loop telemetry · dev.mapsly.ai",
  robots: { index: false, follow: false },
};

// (dev) route group sits OUTSIDE the next-intl tree. The root <html> + fonts
// come from app/layout.tsx; we just wrap the body in our dark-theme container.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <div className="dev-root">{children}</div>;
}
