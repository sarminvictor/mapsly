/**
 * Sticky top bar — brand lockup + the always-visible "See what to fix first" pill.
 * Extracted verbatim from LandingView.tsx during the per-section split.
 */

import { StickyHeader } from "../StickyHeader";

import { Wordmark, Tagline } from "./brand";
import { CtaPill } from "./shared";
import { CONTAINER } from "./style-tokens";

export function TopBar({ ctaHref }: { ctaHref: string }) {
  return (
    <StickyHeader>
      <div
        className="landing-topbar-inner"
        style={{
          ...CONTAINER,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "var(--landing-topbar-h, 66px)",
          padding: "0 20px",
          transition: "height 0.25s ease",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 22 }}>
          <Wordmark />
          <Tagline />
        </span>
        <CtaPill
          href={ctaHref}
          cta="top"
          label="See what to fix first - $29/mo"
          mobileLabel="See what to fix · $29/mo"
          height={60}
        />
      </div>
    </StickyHeader>
  );
}
